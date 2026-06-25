'use strict'

// Animated capture via polled `Page.captureScreenshot` (through puppeteer's
// `page.screenshot`). Unlike the screencast/extension backends — which capture
// live compositor frames and render accelerated layers (WebGL/canvas/video)
// black in headless — `captureScreenshot` forces a full composite, so it is the
// only backend that captures WebGL content. Cost: a per-frame round-trip, so the
// effective frame rate is bounded by screenshot latency (frames are mapped onto
// the constant-fps grid by their real capture time; missed slots hold the last
// frame). Also captures at device pixels (retina), not the screencast's CSS-px.

const { setTimeout: delay } = require('timers/promises')
const fs = require('fs/promises')
const debug = require('debug-logfmt')('browserless:capture')

const { writeHeader } = require('./ebml')
const { getOutputArgs, spawnFfmpeg } = require('./ffmpeg')
const { createFrameMuxer } = require('./screencast')
const { DEFAULT, NOOP } = require('./constants')

const even = value => Math.round(value) & ~1

const getDeviceSize = viewport => {
  const dpr = Math.max(Number(viewport.deviceScaleFactor) || 1, 1)
  return { width: even(viewport.width * dpr), height: even(viewport.height * dpr) }
}

module.exports = async (page, opts, viewport, { onStarted } = {}) => {
  const {
    path: outputPath,
    duration = DEFAULT.duration,
    fps = DEFAULT.fps,
    type = DEFAULT.type,
    encoder,
    quality = 90,
    ffmpegPath
  } = opts

  if (opts.video === false) {
    throw new TypeError('The screenshot backend captures video; `video` cannot be disabled.')
  }

  const { width, height } = getDeviceSize(viewport)

  const { stdin, output } = spawnFfmpeg({
    ffmpegPath,
    args: getOutputArgs({ type, width, height, fps, encoder }),
    timeout: Math.ceil(duration * 2) + 10_000
  })

  const muxer = createFrameMuxer({ stdin, fps, durationMs: duration })
  stdin.write(writeHeader(width, height))

  const frameOptions = { type: 'jpeg', quality, optimizeForSpeed: true }
  const intervalMs = Math.max(1, Math.round(1000 / fps))

  let captureError
  const recordingWindow = new AbortController()
  const capture = new AbortController()

  // Poll screenshots for the recording window. Each frame is timestamped with its
  // real capture time; the muxer maps it onto the fps grid. Stopped via `capture`.
  const polling = (async () => {
    while (!capture.signal.aborted) {
      const startedAt = Date.now()
      try {
        const frame = await page.screenshot(frameOptions)
        muxer.write(frame, Date.now() / 1000)
      } catch (error) {
        // Navigations transiently destroy the execution context; skip that frame.
      }
      const remaining = intervalMs - (Date.now() - startedAt)
      if (remaining > 0) await delay(remaining, undefined, { signal: capture.signal }).catch(NOOP)
    }
  })()

  try {
    // Size the page before the first frame (goto re-applies it during nav).
    await page.setViewport(viewport).catch(NOOP)
    // Navigation runs concurrently; a failure ends the window early.
    const navigation = Promise.resolve(onStarted?.()).catch(error => {
      captureError = error
      recordingWindow.abort()
    })
    await delay(duration, undefined, { signal: recordingWindow.signal }).catch(NOOP)
    await navigation
  } catch (error) {
    captureError = captureError || error
  } finally {
    capture.abort()
    await polling.catch(NOOP)
    muxer.flush()
    stdin.end()
  }

  let buffer
  try {
    buffer = await output
  } catch (error) {
    throw captureError || error
  }
  if (captureError) throw captureError

  if (buffer.length === 0) {
    throw new Error('No video data was captured. Increase `duration` or verify the page renders.')
  }

  if (outputPath) {
    await fs.writeFile(outputPath, buffer)
    debug('screenshot.writeFile', { outputPath, bytes: buffer.length })
  }

  return buffer
}

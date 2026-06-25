'use strict'

const { setTimeout: delay } = require('timers/promises')
const fs = require('fs/promises')
const debug = require('debug-logfmt')('browserless:capture')

const createScreencast = require('@browserless/screencast')
const { writeHeader, writeClusterHeader } = require('./ebml')
const { getOutputArgs, spawnFfmpeg } = require('./ffmpeg')
const { DEFAULT, NOOP } = require('./constants')

// vp8/h264 require even dimensions.
const even = value => Math.round(value) & ~1

// CDP `Page.startScreencast` delivers frames at the CSS-pixel layout viewport,
// NOT device pixels (unlike tab capture, which is retina/device-px). Size the
// output to the CSS viewport so frames fill it exactly without padding/upscaling.
// Net effect: the screencast backend is half the linear resolution of the
// extension backend for a 2x-DPR device. (Distinct from capture.js's device-px
// `getScaledSize`, hence the different name.)
const getViewportSize = viewport => ({
  width: even(viewport.width),
  height: even(viewport.height)
})

// Maps incoming frames onto a constant-fps grid by their real (compositor swap)
// timestamp, and muxes them into a Matroska stream for ffmpeg. Ported from the
// timing logic in Playwright's FfmpegVideoRecorder (Apache-2.0).
const createFrameMuxer = ({ stdin, fps, durationMs }) => {
  let firstTs
  let last = null

  const emit = (buffer, frameNumber) => {
    const timestampMs = Math.max(0, Math.round((frameNumber * 1000) / fps))
    stdin.write(writeClusterHeader(timestampMs, buffer.length))
    stdin.write(buffer)
  }

  return {
    write: (buffer, tsSeconds) => {
      if (firstTs === undefined) firstTs = tsSeconds
      // Hard-bound the clip to `duration`; async screencast stop can deliver a
      // few frames past the deadline that would otherwise lengthen the video.
      if ((tsSeconds - firstTs) * 1000 > durationMs) return
      const frameNumber = Math.floor((tsSeconds - firstTs) * fps)
      // A frame held on screen (no repaint) keeps its slot, so its real duration
      // is preserved instead of being collapsed.
      if (last && frameNumber !== last.frameNumber) emit(last.buffer, last.frameNumber)
      last = { buffer, frameNumber }
    },
    flush: () => {
      if (!last) return
      emit(last.buffer, last.frameNumber)
      // Hold the last frame out to the full requested duration. Screencast is
      // change-driven (no frame after the last repaint), so without this a page
      // that goes static produces a clip shorter than `duration`. ffmpeg `-r`
      // duplicates the held frame to fill the gap.
      const endFrameNumber = Math.floor((durationMs / 1000) * fps)
      if (endFrameNumber > last.frameNumber) emit(last.buffer, endFrameNumber)
    }
  }
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

  // The screencast backend captures video only (CDP screencast has no audio);
  // mirror the extension backend's "must capture something" guard.
  if (opts.video === false) {
    throw new TypeError('The screencast backend captures video; `video` cannot be disabled.')
  }

  const { width, height } = getViewportSize(viewport)

  const { stdin, output } = spawnFfmpeg({
    ffmpegPath,
    args: getOutputArgs({ type, width, height, fps, encoder }),
    // Bound the whole process: the recording window (`duration`) plus generous
    // headroom for the post-`stdin.end()` encode flush. Mirrors the extension
    // backend's `duration * 1.5` safety timeout so a stuck ffmpeg can't hang the
    // capture indefinitely.
    timeout: Math.ceil(duration * 2) + 10_000
  })

  const muxer = createFrameMuxer({ stdin, fps, durationMs: duration })
  stdin.write(writeHeader(width, height))

  const screencast = createScreencast(page, {
    format: 'jpeg',
    quality,
    maxWidth: width,
    maxHeight: height,
    everyNthFrame: 1
  })

  // metadata.timestamp is the compositor frame-swap wall time, in seconds.
  screencast.onFrame((data, metadata) =>
    muxer.write(Buffer.from(data, 'base64'), metadata.timestamp)
  )

  let captureError
  let navigation = Promise.resolve()
  // Bounds the recording window; aborted early if navigation fails so a goto
  // error surfaces immediately instead of after the full `duration`.
  const recordingWindow = new AbortController()
  try {
    // Apply the viewport before the first frame so the screencast captures at the
    // intended size from the start (goto re-applies it idempotently during nav).
    await page.setViewport(viewport).catch(NOOP)
    await screencast.start()

    // The screencast is rolling: only now kick off navigation so the page's load
    // and intro animations are captured from the first frame. Navigation runs
    // concurrently — it does not extend the recording window (so the clip stays
    // bounded to `duration` on slow loads), but a failure ends it early.
    navigation = (onStarted ? Promise.resolve().then(onStarted) : Promise.resolve()).catch(
      error => {
        captureError = error
        recordingWindow.abort()
      }
    )
    await delay(duration, undefined, { signal: recordingWindow.signal }).catch(() => {})
  } catch (error) {
    captureError = captureError || error
  } finally {
    await screencast.stop().catch(NOOP)
    muxer.flush()
    stdin.end()
  }

  let buffer
  try {
    buffer = await output
  } catch (error) {
    // Prefer the underlying capture/navigation failure over a downstream ffmpeg
    // error (a non-zero exit is expected when an early abort leaves little data).
    throw captureError || error
  }
  // Let navigation settle before returning so the caller doesn't tear the page
  // down mid-navigation (goto has its own timeout, so this can't hang).
  await navigation
  if (captureError) throw captureError

  if (buffer.length === 0) {
    throw new Error(
      'No video data was captured. Increase `duration` or verify playback in the tab.'
    )
  }

  if (outputPath) {
    await fs.writeFile(outputPath, buffer)
    debug('screencast.writeFile', { outputPath, bytes: buffer.length })
  }

  return buffer
}

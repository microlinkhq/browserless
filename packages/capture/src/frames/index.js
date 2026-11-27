'use strict'

const { readFileSync } = require('fs')
const fs = require('fs/promises')
const { performance } = require('perf_hooks')
const debug = require('debug-logfmt')('browserless:capture')

const createCapture = require('../create-capture')
const { getDeviceSize, createFrameMuxer } = require('../recorder')
const { writeHeader } = require('../recorder/ebml')
const { getOutputArgs, spawnFfmpeg } = require('../recorder/ffmpeg')
const { DEFAULT, NOOP } = require('../constants')

const FRAME_TIMEOUT = 5000

const TIMEWEB = readFileSync(require.resolve('timeweb/dist/timeweb.js'), 'utf8')

const frameCount = ({ duration, fps }) => Math.max(1, Math.round((duration * fps) / 1000))

const frameTime = (frame, fps) => (frame * 1000) / fps

const goToVirtualTime = (frame, ms) =>
  frame.evaluate(ms => {
    if (!window.timeweb) return false
    return window.timeweb.goTo(ms).then(() => true)
  }, ms)

const advanceTime = async (page, ms) => {
  const mainFrame = page.mainFrame()
  const childFrames = page.frames().filter(frame => frame !== mainFrame)
  const [hasTimeweb] = await Promise.all([
    goToVirtualTime(mainFrame, ms),
    ...childFrames.map(frame => goToVirtualTime(frame, ms).catch(NOOP))
  ])
  if (!hasTimeweb) {
    throw new Error('The frames mode needs the page loaded by `goto`, so timeweb runs first.')
  }
}

const withFrameTimeout = (work, { frame, frameTimeout }) => {
  let timer
  const expired = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Frame ${frame} did not render within ${frameTimeout}ms.`)),
      frameTimeout
    )
  })
  return Promise.race([work, expired]).finally(() => clearTimeout(timer))
}

const captureScreenshot = async (client, quality) => {
  const { data } = await client.send('Page.captureScreenshot', {
    format: 'jpeg',
    quality,
    optimizeForSpeed: true
  })
  return Buffer.from(data, 'base64')
}

const renderFrame = async ({ page, client, quality, timing }, ms) => {
  const startedAt = performance.now()
  await advanceTime(page, ms)
  const advancedAt = performance.now()
  const screenshot = await captureScreenshot(client, quality)
  timing.advanceMs += advancedAt - startedAt
  timing.captureMs += performance.now() - advancedAt
  timing.bytes += screenshot.length
  return screenshot
}

const averagePerFrame = (timing, frames) => ({
  advanceMs: Math.round(timing.advanceMs / frames),
  captureMs: Math.round(timing.captureMs / frames),
  frameKb: Math.round(timing.bytes / frames / 1024)
})

const stepFrames = async ({ page, muxer, frames, fps, quality, frameTimeout, signal }) => {
  const client = await page.createCDPSession()
  const timing = { advanceMs: 0, captureMs: 0, bytes: 0 }
  try {
    for (let frame = 0; frame < frames; frame++) {
      signal?.throwIfAborted()
      const screenshot = await withFrameTimeout(
        renderFrame({ page, client, quality, timing }, frameTime(frame, fps)),
        { frame, frameTimeout }
      )
      await muxer.writeFrame(screenshot, frame)
    }
    return averagePerFrame(timing, frames)
  } finally {
    await client.detach().catch(NOOP)
  }
}

const runFrames = async (page, opts, viewport, { onStarted } = {}) => {
  if (opts.video === false) {
    throw new TypeError('The frames mode captures video; `video` cannot be disabled.')
  }

  const {
    path: outputPath,
    duration = DEFAULT.duration,
    fps = DEFAULT.fps,
    type = DEFAULT.type,
    encoder,
    quality = 90,
    ffmpegPath,
    timeout,
    frameTimeout = FRAME_TIMEOUT,
    signal
  } = opts

  const { identifier } = await page.evaluateOnNewDocument(TIMEWEB)
  try {
    await onStarted?.()

    const { width, height } = getDeviceSize(viewport)
    const { stdin, output } = spawnFfmpeg({
      ffmpegPath,
      args: getOutputArgs({ type, width, height, fps, encoder }),
      timeout
    })
    const muxer = createFrameMuxer({ stdin, fps, durationMs: duration })
    stdin.write(writeHeader(width, height))

    const frames = frameCount({ duration, fps })
    const startedAt = Date.now()
    let perFrame
    try {
      perFrame = await stepFrames({ page, muxer, frames, fps, quality, frameTimeout, signal })
    } catch (error) {
      stdin.end()
      await output.catch(NOOP)
      throw error
    }
    stdin.end()
    const buffer = await output
    debug('frames', { frames, frameMs: Math.round((Date.now() - startedAt) / frames), ...perFrame })

    if (outputPath) {
      await fs.writeFile(outputPath, buffer)
      debug('frames.writeFile', { outputPath, bytes: buffer.length })
    }

    return buffer
  } finally {
    await page.removeScriptToEvaluateOnNewDocument(identifier).catch(NOOP)
  }
}

module.exports = createCapture(runFrames, 'frames')
module.exports.frameCount = frameCount

'use strict'

// Animated capture via polled `Page.captureScreenshot` (through puppeteer's
// `page.screenshot`). Unlike the screencast/extension modes — which capture
// live compositor frames and render accelerated layers (WebGL/canvas/video)
// black in headless — `captureScreenshot` forces a full composite, so it is the
// only mode that captures WebGL content. Cost: a per-frame round-trip, so the
// effective frame rate is bounded by screenshot latency (frames are mapped onto
// the constant-fps grid by their real capture time; missed slots hold the last
// frame). Also captures at device pixels (retina), not the screencast's CSS-px.

const { setTimeout: delay } = require('timers/promises')
const { even, record } = require('../recorder')
const createCapture = require('../create-capture')
const { NOOP } = require('../constants')

const getDeviceSize = viewport => {
  const dpr = Math.max(Number(viewport.deviceScaleFactor) || 1, 1)
  return { width: even(viewport.width * dpr), height: even(viewport.height * dpr) }
}

// Pull source: poll screenshots for the recording window. Each frame is
// timestamped with its real capture time; the muxer maps it onto the fps grid.
const startSource = ({ page, muxer, fps, quality }) => {
  const capture = new AbortController()
  const frameOptions = { type: 'jpeg', quality, optimizeForSpeed: true }
  const intervalMs = Math.max(1, Math.round(1000 / fps))

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

  return async () => {
    capture.abort()
    await polling.catch(NOOP)
  }
}

const runScreenshot = (page, opts, viewport, hooks = {}) =>
  record(page, opts, viewport, {
    ...hooks,
    getSize: getDeviceSize,
    startSource,
    label: 'screenshot'
  })

module.exports = createCapture(runScreenshot, 'screenshot')

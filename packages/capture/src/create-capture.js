'use strict'

const debug = require('debug-logfmt')('browserless:capture')
const createGoto = require('@browserless/goto')

// Resolve the device viewport and apply it before recording starts. Tab-capture
// constraints pin exact width/height, so the page must already match the target
// device when getUserMedia runs — otherwise a custom `device` can overconstrain
// against the browser's default viewport and fail before navigation begins.
// The ffmpeg-based modes also call `page.setViewport` in the recorder; the
// duplicate apply is idempotent.
const prepareViewport = async (goto, page, opts) => {
  if (typeof goto.getDevice === 'function') {
    const device = goto.getDevice({
      headers: { ...(opts.headers || {}) },
      device: opts.device ?? goto.defaultDevice,
      viewport: opts.viewport
    })
    if (device && device.viewport) {
      await page.setViewport(device.viewport)
      return device.viewport
    }
  }
  return page.viewport()
}

// Build the public capture factory for a given mode. Each mode (extension /
// screencast / screenshot) is published as its own entry point and wraps its
// runner with this shared "navigate concurrently inside the recording window"
// flow, so the selected mode is explicit at `require` time rather than dispatched
// from an option at call time.
module.exports =
  (runMode, mode) =>
    ({ goto, ...gotoOpts } = {}) => {
      goto = goto || createGoto(gotoOpts)
      return function capture (page) {
        return async (url, opts = {}) => {
          const duration = debug.duration({ url })
          const viewport = await prepareViewport(goto, page, opts)
          const result = await runMode(page, opts, viewport, {
            onStarted: () => goto(page, { ...opts, url, animations: true })
          })
          duration.info({ mode })
          return result
        }
      }
    }

'use strict'

const debug = require('debug-logfmt')('browserless:capture')
const createGoto = require('@browserless/goto')

// Resolve the device (and therefore the viewport) without navigating, so the
// recorder can be sized and started before `goto` runs. The viewport is derived
// from the `device`/`viewport` opts, which are known ahead of navigation.
const resolveViewport = (goto, page, opts) => {
  if (typeof goto.getDevice === 'function') {
    const device = goto.getDevice({
      headers: { ...(opts.headers || {}) },
      device: opts.device ?? goto.defaultDevice,
      viewport: opts.viewport
    })
    if (device && device.viewport) return device.viewport
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
          const viewport = resolveViewport(goto, page, opts)
          const result = await runMode(page, opts, viewport, {
            onStarted: () => goto(page, { ...opts, url, animations: true })
          })
          duration.info({ mode })
          return result
        }
      }
    }

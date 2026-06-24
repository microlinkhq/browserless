'use strict'

const debug = require('debug-logfmt')('browserless:capture')
const createGoto = require('@browserless/goto')

const {
  DEFAULT,
  DEFAULT_CODEC_BY_TYPE,
  EXTENSION_ID,
  EXTENSION_PATH,
  TYPES
} = require('./constants')
const runCapture = require('./capture')

// Resolve the device (and therefore the viewport) without navigating, so the
// recorder can be sized and started before `goto` runs. The viewport is derived
// from the `device`/`viewport` opts, which are known ahead of navigation.
const resolveViewport = (goto, page, opts) => {
  if (typeof goto.getDevice === 'function') {
    const device = goto.getDevice({
      headers: { ...(opts.headers || {}) },
      device: opts.device,
      viewport: opts.viewport
    })
    if (device && device.viewport) return device.viewport
  }
  return page.viewport()
}

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)
  return function capture (page) {
    return async (url, opts = {}) => {
      const duration = debug.duration({ url })
      const viewport = resolveViewport(goto, page, opts)
      const result = await runCapture(page, opts, viewport, {
        onStarted: () => goto(page, { ...opts, url, animations: true })
      })
      duration.info()
      return result
    }
  }
}

module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.TYPES = TYPES
module.exports.DEFAULT = DEFAULT
module.exports.DEFAULT_CODEC_BY_TYPE = DEFAULT_CODEC_BY_TYPE

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
const runScreencastCapture = require('./screencast')

const BACKENDS = { extension: runCapture, screencast: runScreencastCapture }
const DEFAULT_BACKEND = 'extension'

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

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)
  return function capture (page) {
    return async (url, opts = {}) => {
      const duration = debug.duration({ url })
      const viewport = resolveViewport(goto, page, opts)
      // `backend` selects the capture implementation: the default in-browser
      // MediaRecorder/extension recorder, or the CDP screencast + ffmpeg backend.
      const runBackend = BACKENDS[opts.backend] || BACKENDS[DEFAULT_BACKEND]
      const result = await runBackend(page, opts, viewport, {
        onStarted: () => goto(page, { ...opts, url, animations: true })
      })
      duration.info({ backend: opts.backend || DEFAULT_BACKEND })
      return result
    }
  }
}

module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.TYPES = TYPES
module.exports.BACKENDS = Object.keys(BACKENDS)
module.exports.ENCODERS = runScreencastCapture.ENCODERS
module.exports.DEFAULT = DEFAULT
module.exports.DEFAULT_CODEC_BY_TYPE = DEFAULT_CODEC_BY_TYPE

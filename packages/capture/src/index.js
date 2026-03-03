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

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)
  return function capture (page) {
    return async (url, opts = {}) => {
      const duration = debug.duration({ url })
      const { device } = await goto(page, { ...opts, url, animations: true })
      const result = await runCapture(page, opts, device.viewport)
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

'use strict'

const debug = require('debug-logfmt')('browserless:capture')
const createGoto = require('@browserless/goto')

const { EXTENSION_ID, EXTENSION_PATH, TYPES } = require('./constants')
const capture = require('./capture')

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)
  return page =>
    async (url, opts = {}) => {
      const duration = debug.duration()
      const { device } = await goto(page, { ...opts, url })
      const result = await capture(page, opts, device.viewport)
      duration.info()
      return result
    }
}

module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.types = TYPES

'use strict'

const {
  DEFAULT,
  DEFAULT_CODEC_BY_TYPE,
  EXTENSION_ID,
  EXTENSION_PATH,
  TYPES
} = require('./constants')
const { ENCODERS } = require('./recorder/ffmpeg')

// The default entry point is the in-browser extension (MediaRecorder) mode. The
// ffmpeg-based modes are published as their own entry points so consumers pull
// in only what they use:
//
//   require('@browserless/capture')             // extension (default)
//   require('@browserless/capture/screencast')  // CDP screencast + ffmpeg
//   require('@browserless/capture/screenshot')  // polled screenshot + ffmpeg
module.exports = require('./extension')

module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.TYPES = TYPES
module.exports.MODES = ['extension', 'screencast', 'screenshot']
module.exports.ENCODERS = ENCODERS
module.exports.DEFAULT = DEFAULT
module.exports.DEFAULT_CODEC_BY_TYPE = DEFAULT_CODEC_BY_TYPE

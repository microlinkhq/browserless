'use strict'

const path = require('path')

module.exports = {
  MAX_FRAME_RATE: 120,
  DEFAULT: Object.freeze({ duration: 3000, type: 'mp4' }),
  DEFAULT_CODEC_BY_TYPE: Object.freeze({
    webm: 'vp9',
    mp4: 'avc1.4D401F'
  }),
  EXTENSION_ID: 'jjndjgheafjngoipoacpjgeicjeomjli',
  EXTENSION_PATH: path.join(__dirname, '..', 'extension'),
  TYPES: Object.freeze(['webm', 'mp4']),
  INTERNAL_FRAME_SIZE: 250,
  NOOP: () => {}
}

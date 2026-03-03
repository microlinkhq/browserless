'use strict'

const path = require('path')

module.exports = {
  DEFAULT: Object.freeze({ duration: 3000, type: 'mp4' }),
  DEFAULT_CODEC_BY_TYPE: Object.freeze({
    webm: 'vp9',
    mp4: 'avc1.640028'
  }),
  EXTENSION_ID: 'jjndjgheafjngoipoacpjgeicjeomjli',
  EXTENSION_PATH: path.join(__dirname, '..', 'extension'),
  TYPES: Object.freeze(['webm', 'mp4']),
  NOOP: () => {}
}

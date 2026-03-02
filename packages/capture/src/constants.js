'use strict'

const path = require('path')

module.exports = {
  DEFAULT: { duration: 3000, type: 'webm' },
  EXTENSION_ID: 'jjndjgheafjngoipoacpjgeicjeomjli',
  EXTENSION_PATH: path.join(__dirname, '..', 'extension'),
  TYPES: Object.freeze(['webm', 'mp4']),
  INTERNAL_FRAME_SIZE: 250,
  NOOP: () => {}
}

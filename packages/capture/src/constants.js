'use strict'

const path = require('path')

module.exports = {
  MAX_FRAME_RATE: 120,
  DEFAULT: Object.freeze({ duration: 3000, type: 'mp4', quality: 'high' }),
  DEFAULT_CODEC_BY_TYPE: Object.freeze({
    webm: 'vp9',
    mp4: 'avc1.4D401F'
  }),
  EXTENSION_ID: 'jjndjgheafjngoipoacpjgeicjeomjli',
  EXTENSION_PATH: path.join(__dirname, '..', 'extension'),
  TYPES: Object.freeze(['webm', 'mp4']),
  QUALITIES: Object.freeze(['extra-high', 'high', 'medium', 'low', 'extra-low']),
  VIDEO_BITS_PER_SECOND_BY_QUALITY: Object.freeze({
    'extra-high': 20_000_000,
    high: 8_000_000,
    medium: 5_000_000,
    low: 2_500_000,
    'extra-low': 1_000_000
  }),
  INTERNAL_FRAME_SIZE: 250,
  NOOP: () => {}
}

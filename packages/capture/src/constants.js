'use strict'

const path = require('path')

const EXTENSION_ID = 'jjndjgheafjngoipoacpjgeicjeomjli'

const EXTENSION_PATH = path.join(__dirname, '..', 'extension')

const MIME_TYPES_BY_TYPE = Object.freeze({
  webm: {
    video: 'video/webm',
    audio: 'audio/webm'
  },
  mp4: {
    video: 'video/mp4',
    audio: 'audio/mp4'
  },
  mkv: {
    video: 'video/x-matroska;codecs=avc1'
  },
  matroska: {
    video: 'video/x-matroska;codecs=avc1'
  }
})

const TYPES = Object.freeze(Object.keys(MIME_TYPES_BY_TYPE))
const INTERNAL_FRAME_SIZE = 250
const NOOP = () => {}

module.exports = {
  EXTENSION_ID,
  EXTENSION_PATH,
  MIME_TYPES_BY_TYPE,
  TYPES,
  INTERNAL_FRAME_SIZE,
  NOOP
}

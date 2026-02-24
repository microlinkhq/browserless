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
const DEFAULT_TAB_QUERY = Object.freeze({ active: true })
const DEFAULT_RETRY_POLICY = Object.freeze({ each: 20, times: 3 })
const DEFAULT_WAIT_UNTIL = 'networkidle2'

module.exports = {
  EXTENSION_ID,
  EXTENSION_PATH,
  MIME_TYPES_BY_TYPE,
  TYPES,
  DEFAULT_TAB_QUERY,
  DEFAULT_RETRY_POLICY,
  DEFAULT_WAIT_UNTIL
}

'use strict'

const path = require('path')

const EXTENSION_ID = 'jjndjgheafjngoipoacpjgeicjeomjli'

const EXTENSION_PATH = path.join(__dirname, '..', 'extension')

const TYPES = Object.freeze(['webm', 'mp4'])
const INTERNAL_FRAME_SIZE = 250
const NOOP = () => {}

module.exports = {
  EXTENSION_ID,
  EXTENSION_PATH,
  TYPES,
  INTERNAL_FRAME_SIZE,
  NOOP
}

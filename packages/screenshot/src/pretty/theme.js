'use strict'

const { readFile } = require('fs').promises
const path = require('path')

const THEME_CACHE = Object.create(null)
const THEME_PATHS = path.resolve(__dirname, '../../node_modules/prism-themes/themes')

module.exports = async themeId =>
  THEME_CACHE[themeId] ||
  (THEME_CACHE[themeId] = await readFile(path.resolve(THEME_PATHS, `prism-${themeId}.css`)))

'use strict'

const { isUrl } = require('@browserless/goto')
const { readFile } = require('fs').promises
const path = require('path')

const THEME_CACHE = Object.create(null)
const THEME_PATHS = path.resolve(__dirname, '../../node_modules/prism-themes/themes')

module.exports = async themeId => {
  if (isUrl(themeId)) {
    return `<link rel="stylesheet" type="text/css" href="${themeId}">`
  }

  const theme =
    THEME_CACHE[themeId] ||
    (THEME_CACHE[themeId] = await readFile(path.resolve(THEME_PATHS, `prism-${themeId}.css`)))

  return `<style>${theme}</style>`
}

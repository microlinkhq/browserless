'use strict'

const { readFile } = require('fs/promises')
const isHttpUrl = require('is-url-http')
const path = require('path')

const CACHE = Object.create(null)

const GET_THEME_PATH = () => require('prism-themes').themesDirectory

const THEME_PATH = () => CACHE.root || (CACHE.root = GET_THEME_PATH())

module.exports = async themeId => {
  if (isHttpUrl(themeId)) return `<link rel="stylesheet" type="text/css" href="${themeId}">`

  const stylesheet =
    CACHE[themeId] ||
    (CACHE[themeId] = await readFile(path.resolve(THEME_PATH(), `prism-${themeId}.css`)))

  return `<style>${stylesheet}</style>`
}

'use strict'

const NullProtoObj = require('null-prototype-object')
const { readFile } = require('fs/promises')
const isHttpUrl = require('is-url-http')
const path = require('path')

const CACHE = new NullProtoObj()

const GET_THEME_PATH = () => require('prism-themes').themesDirectory

const THEME_PATH = () => CACHE.root || (CACHE.root = GET_THEME_PATH())

const escapeHtml = str => str
  .replace(/&/g, '&amp;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')

module.exports = async themeId => {
  if (isHttpUrl(themeId)) return `<link rel="stylesheet" type="text/css" href="${escapeHtml(themeId)}">`

  const stylesheet =
    CACHE[themeId] ||
    (CACHE[themeId] = await readFile(path.resolve(THEME_PATH(), `prism-${themeId}.css`)))

  return `<style>${stylesheet}</style>`
}

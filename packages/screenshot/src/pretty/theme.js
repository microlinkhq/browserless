'use strict'

const NullProtoObj = require('null-prototype-object')
const { readFile } = require('fs/promises')
const isHttpUrl = require('is-url-http')
const path = require('path')

const { existsSync, readdirSync } = require('fs')

const CACHE = new NullProtoObj()
let themeIndex

const GET_THEME_INDEX = () => {
  const automadRoot = path.dirname(require.resolve('automad-prism-themes/package.json'))
  const { themesDirectory } = require('automad-prism-themes')
  const prismRoot = path.dirname(require.resolve('prism-themes/package.json'))
  const { themesDirectory: prismThemesDirectory } = require('prism-themes')

  const dirs = [
    themesDirectory,
    path.resolve(automadRoot, 'dist'),
    prismThemesDirectory,
    path.resolve(prismRoot, 'themes')
  ].filter(dir => dir && existsSync(dir))

  const index = new NullProtoObj()
  for (const dir of dirs) {
    for (const file of readdirSync(dir)) {
      const match = file.match(/^prism-(.+)\.css$/)
      if (match && !match[1].endsWith('.min') && !(match[1] in index)) {
        index[match[1]] = path.resolve(dir, file)
      }
    }
  }
  return index
}

const THEME_INDEX = () => themeIndex || (themeIndex = GET_THEME_INDEX())

const readTheme = async themeId => {
  const filePath = THEME_INDEX()[themeId]
  if (!filePath) throw new Error(`Unable to resolve Prism theme: ${themeId}`)
  return readFile(filePath)
}

module.exports = async themeId => {
  if (isHttpUrl(themeId)) return `<link rel="stylesheet" type="text/css" href="${themeId}">`
  CACHE[themeId] = CACHE[themeId] || (await readTheme(themeId))
  return `<style>${CACHE[themeId]}</style>`
}

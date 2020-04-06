'use strict'

const { readFile } = require('fs').promises
const path = require('path')

const getPrism = readFile(path.resolve(__dirname, 'prism.js'))
const getTheme = require('./theme')
const getHtml = require('./html')

const { injectScripts, injectStyles } = require('@browserless/goto')

module.exports = async (page, response, { codeScheme, contentType, styles, scripts, modules }) => {
  const isHTML = contentType === 'html'
  const [theme, payload, prism] = await Promise.all([
    getTheme(codeScheme),
    response[isHTML ? 'text' : contentType](),
    getPrism
  ])

  if (isHTML && payload.startsWith('<')) {
    return
  }

  const html = getHtml(payload, { contentType, prism, theme })
  await page.setContent(html)

  await Promise.all(
    [
      modules && injectScripts(page, modules, { type: 'modules' }),
      scripts && injectScripts(page, scripts),
      styles && injectStyles(page, styles)
    ].filter(Boolean)
  )
}

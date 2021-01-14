'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const { readFile } = require('fs').promises
const { extension } = require('mime-types')
const isHtml = require('is-html-content')
const prettyMs = require('pretty-ms')
const timeSpan = require('time-span')
const path = require('path')

const getPrism = readFile(path.resolve(__dirname, 'prism.js'))
const getTheme = require('./theme')
const getHtml = require('./html')

const PRETTY_CONTENT_TYPES = ['json', 'text', 'html']

const { injectScripts, injectStyles } = require('@browserless/goto')

const getContentType = headers => {
  const contentType = extension(headers['content-type'])
  return contentType === 'txt' ? 'text' : contentType
}

module.exports = async (page, response, { codeScheme, styles, scripts, modules }) => {
  if (!response || !codeScheme) return

  const contentType = getContentType(response.headers())

  if (!PRETTY_CONTENT_TYPES.includes(contentType)) return

  const isHtmlContentType = contentType === 'html'

  const [theme, payload, prism] = await Promise.all([
    getTheme(codeScheme),
    response[isHtmlContentType ? 'text' : contentType](),
    getPrism
  ])

  if (isHtmlContentType && isHtml(payload)) return

  const timePretty = timeSpan()
  const html = getHtml(payload, { contentType, prism, theme })
  await page.setContent(html)

  await Promise.all(
    [
      modules && injectScripts(page, modules, { type: 'modules' }),
      scripts && injectScripts(page, scripts),
      styles && injectStyles(page, styles)
    ].filter(Boolean)
  )

  debug('pretty', { duration: prettyMs(timePretty()) })
}

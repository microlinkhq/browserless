'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const isHtmlContent = require('is-html-content')
const { readFile } = require('fs').promises
const { extension } = require('mime-types')
const prettyMs = require('pretty-ms')
const timeSpan = require('time-span')
const path = require('path')

const getPrism = readFile(path.resolve(__dirname, 'prism.js'))
const getTheme = require('./theme')
const getHtml = require('./html')

const PRETTY_CONTENT_TYPES = ['json', 'text', 'html']

const { inject } = require('@browserless/goto')

const getContentType = headers => {
  const contentType = extension(headers['content-type'])
  return contentType === 'txt' ? 'text' : contentType
}

module.exports = async (page, response, { timeout, codeScheme, styles, scripts, modules }) => {
  if (!response || !codeScheme) return

  const contentType = getContentType(response.headers())

  if (!PRETTY_CONTENT_TYPES.includes(contentType)) return

  const isHtmlContentType = contentType === 'html'

  const [theme, content, prism] = await Promise.all([
    getTheme(codeScheme),
    response[isHtmlContentType ? 'text' : contentType](),
    getPrism
  ])

  if (isHtmlContentType && isHtmlContent(content)) return

  const timePretty = timeSpan()
  const html = getHtml(content, { contentType, prism, theme })
  await page.setContent(html)
  await inject(page, { timeout, modules, scripts, styles })

  debug('pretty', { duration: prettyMs(timePretty()) })
}

'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const isHtmlContent = require('is-html-content')
const { readFile } = require('fs/promises')
const { getExtension } = require('mime')
const path = require('path')

const getPrism = readFile(path.resolve(__dirname, 'prism.js'))
const timeSpan = require('../time-span')
const getTheme = require('./theme')
const getHtml = require('./html')

const PRETTY_CONTENT_TYPES = ['json', 'text', 'html']

const { inject } = require('@browserless/goto')

const getContentType = headers => {
  const contentType = getExtension(headers['content-type']?.split(';')[0].trim().toLowerCase())
  return contentType === 'txt' ? 'text' : contentType
}

const JSONParse = input => {
  try {
    return {
      json: JSON.parse(input),
      error: false
    }
  } catch (error) {
    return { error: true }
  }
}

module.exports = async (page, response, { timeout, codeScheme, styles, scripts, modules }) => {
  if (!response || !codeScheme) return

  let [theme, content, prism] = await Promise.all([getTheme(codeScheme), response.text(), getPrism])

  if (isHtmlContent(content)) return

  let contentType = getContentType(response.headers())

  const { json, error } = JSONParse(content)

  if (!error) {
    content = json
    contentType = 'json'
  }

  if (!PRETTY_CONTENT_TYPES.includes(contentType)) return
  const timePretty = timeSpan()
  const html = getHtml(content, { contentType, prism, theme })
  await page.setContent(html)
  await inject(page, { timeout, modules, scripts, styles })

  debug('pretty', { duration: timePretty() })
}

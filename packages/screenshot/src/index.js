'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')

const { extension } = require('mime-types')
const prettyMs = require('pretty-ms')
const timeSpan = require('time-span')
const pReflect = require('p-reflect')

const pretty = require('./pretty')
const createGoto = require('./goto')
const overlay = require('./overlay')

const PRETTY_CONTENT_TYPES = ['json', 'text', 'html']

const getContentType = headers => {
  const contentType = extension(headers['content-type'])
  return contentType === 'txt' ? 'text' : contentType
}

module.exports = gotoOpts => {
  const goto = createGoto(gotoOpts)

  return page => async (
    url,
    { codeScheme = 'atom-dark', overlay: overlayOpts = {}, ...opts } = {}
  ) => {
    const timeGoto = timeSpan()
    const [screenshotOpts, response] = await goto(page, url, opts)
    debug('goto', { duration: prettyMs(timeGoto()) })

    if (codeScheme && response) {
      const headers = response.headers()
      const contentType = getContentType(headers)

      if (PRETTY_CONTENT_TYPES.includes(contentType)) {
        const timePretty = timeSpan()
        await pReflect(pretty(page, response, { codeScheme, contentType, ...opts }))
        debug('pretty', { duration: prettyMs(timePretty()) })
      }
    }

    const timeScreenshot = timeSpan()
    const screenshot = await page.screenshot({
      ...opts,
      ...screenshotOpts
    })
    debug('screenshot', { duration: prettyMs(timeScreenshot()) })

    return Object.keys(overlayOpts).length === 0
      ? screenshot
      : overlay(screenshot, { ...opts, ...overlayOpts })
  }
}

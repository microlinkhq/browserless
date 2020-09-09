'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const { extension } = require('mime-types')
const prettyMs = require('pretty-ms')
const timeSpan = require('time-span')
const pReflect = require('p-reflect')

const isWhiteScreenshot = require('./is-white-screenshot')
const overlay = require('./overlay')
const pretty = require('./pretty')

const PRETTY_CONTENT_TYPES = ['json', 'text', 'html']

const getContentType = headers => {
  const contentType = extension(headers['content-type'])
  return contentType === 'txt' ? 'text' : contentType
}

const getBoundingClientRect = element => {
  const { top, left, height, width, x, y } = element.getBoundingClientRect()
  return { top, left, height, width, x, y }
}

module.exports = ({ goto, ...gotoOpts }) => {
  goto = goto || createGoto(gotoOpts)

  return page => async (
    url,
    {
      element,
      codeScheme = 'atom-dark',
      overlay: overlayOpts = {},
      waitUntil = 'auto',
      ...opts
    } = {}
  ) => {
    let screenshotOpts
    let screenshot
    let response

    if (element) {
      await page.waitForSelector(element, { visible: true })
      screenshotOpts.clip = await page.$eval(element, getBoundingClientRect)
      screenshotOpts.fullPage = false
    }

    const timeScreenshot = timeSpan()

    if (waitUntil !== 'auto') {
      ;({ response } = await goto(page, { ...opts, waitUntil, url }))
      screenshot = await page.screenshot({ ...opts, ...screenshotOpts })
      debug('screenshot', { waitUntil, duration: prettyMs(timeScreenshot()) })
    } else {
      const waitUntilAuto = async (page, screenshotOpts) => {
        screenshot = await page.screenshot(screenshotOpts)
        const isWhite = await isWhiteScreenshot(screenshot)

        if (isWhite) {
          await createGoto.waitUntilAuto(page, opts)
          screenshot = await page.screenshot(screenshotOpts)
        }
        debug('screenshot', {
          waitUntil,
          isWhite,
          duration: prettyMs(timeScreenshot())
        })
      }
      ;({ response } = await goto(page, { ...opts, url, waitUntilAuto }))
    }

    if (codeScheme && response) {
      const headers = response.headers()
      const contentType = getContentType(headers)

      if (PRETTY_CONTENT_TYPES.includes(contentType)) {
        await pReflect(pretty(page, response, { codeScheme, contentType, ...opts }))
      }
    }

    return Object.keys(overlayOpts).length === 0
      ? screenshot
      : overlay(screenshot, { ...opts, ...overlayOpts })
  }
}

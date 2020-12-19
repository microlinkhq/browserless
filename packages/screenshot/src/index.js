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

const waitForElement = async (page, element) => {
  const screenshotOpts = {}

  if (element) {
    await page.waitForSelector(element, { visible: true })
    screenshotOpts.clip = await page.$eval(element, getBoundingClientRect)
    screenshotOpts.fullPage = false
    return screenshotOpts
  }

  return screenshotOpts
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
    let screenshot
    let response

    const prettify = async response => {
      if (codeScheme && response) {
        const headers = response.headers()
        const contentType = getContentType(headers)

        if (PRETTY_CONTENT_TYPES.includes(contentType)) {
          await pReflect(pretty(page, response, { codeScheme, contentType, ...opts }))
        }
      }
    }

    const takeScreenshot = async opts => {
      screenshot = await page.screenshot(opts)
      const isWhite = await isWhiteScreenshot(screenshot)
      if (isWhite) {
        await goto.waitUntilAuto(page, opts)
        screenshot = await page.screenshot(opts)
      }
      return { isWhite }
    }

    page.on('dialog', dialog => dialog.dismiss())

    const timeScreenshot = timeSpan()

    if (waitUntil !== 'auto') {
      ;({ response } = await goto(page, { ...opts, url, waitUntil }))
      await prettify(response)
      const screenshotOpts = await waitForElement(page, element)
      screenshot = await page.screenshot({ ...opts, ...screenshotOpts })
      debug('screenshot', { waitUntil, duration: prettyMs(timeScreenshot()) })
    } else {
      ;({ response } = await goto(page, { ...opts, url, waitUntilAuto }))
      async function waitUntilAuto (page, { response }) {
        await prettify(response)
        const screenshotOpts = await waitForElement(page, element)
        const { isWhite } = await takeScreenshot({ ...opts, ...screenshotOpts })
        debug('screenshot', { waitUntil, isWhite, duration: prettyMs(timeScreenshot()) })
      }
    }

    return Object.keys(overlayOpts).length === 0
      ? screenshot
      : overlay(screenshot, { ...opts, ...overlayOpts })
  }
}

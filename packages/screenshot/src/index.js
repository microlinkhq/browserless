'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const prettyMs = require('pretty-ms')
const timeSpan = require('time-span')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')

const isWhiteScreenshot = require('./is-white-screenshot')
const waitForPrism = require('./pretty')
const overlay = require('./overlay')

const getBoundingClientRect = element => {
  const { top, left, height, width, x, y } = element.getBoundingClientRect()
  return { top, left, height, width, x, y }
}

/* eslint-disable */
const waitForImagesOnViewport = page =>
  page.$$eval('img[src]:not([aria-hidden="true"])', elements =>
    Promise.all(
      elements
        .filter(el => el.getBoundingClientRect().top <= window.innerHeight)
        .map(el => el.decode())
    )
  )
/* eslint-enable */

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

  const timeout = goto.timeout * (1 / 8)

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

    const beforeScreenshot = response =>
      pReflect(
        Promise.all([
          waitForPrism(page, response, { codeScheme, ...opts }),
          pTimeout(waitForImagesOnViewport(page, { timeout }), timeout)
        ])
      )

    const takeScreenshot = async opts => {
      screenshot = await page.screenshot(opts)
      const isWhite = await isWhiteScreenshot(screenshot)
      if (isWhite) {
        await goto.waitUntilAuto(page, opts)
        screenshot = await page.screenshot(opts)
      }
      return { isWhite }
    }

    page.on('dialog', dialog => pReflect(dialog.dismiss()))

    const timeScreenshot = timeSpan()

    if (waitUntil !== 'auto') {
      ;({ response } = await goto(page, { ...opts, url, waitUntil }))
      const [screenshotOpts] = await Promise.all([
        waitForElement(page, element),
        beforeScreenshot(response)
      ])
      screenshot = await page.screenshot({ ...opts, ...screenshotOpts })
      debug('screenshot', { waitUntil, duration: prettyMs(timeScreenshot()) })
    } else {
      ;({ response } = await goto(page, { ...opts, url, waitUntilAuto }))
      async function waitUntilAuto (page, { response }) {
        const [screenshotOpts] = await Promise.all([
          waitForElement(page, element),
          beforeScreenshot(response)
        ])
        const { isWhite } = await takeScreenshot({ ...opts, ...screenshotOpts })
        debug('screenshot', { waitUntil, isWhite, duration: prettyMs(timeScreenshot()) })
      }
    }

    return Object.keys(overlayOpts).length === 0
      ? screenshot
      : overlay(screenshot, { ...opts, ...overlayOpts })
  }
}

'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const isWhiteScreenshot = require('./is-white-screenshot')
const waitForPrism = require('./pretty')
const timeSpan = require('./time-span')
const overlay = require('./overlay')

const getBoundingClientRect = element => {
  const { top, left, height, width, x, y } = element.getBoundingClientRect()
  return { top, left, height, width, x, y }
}

const waitForImagesOnViewport = page =>
  page.$$eval('img[src]:not([aria-hidden="true"])', elements =>
    Promise.all(
      elements
        .filter(el => {
          if (el.naturalHeight === 0 || el.naturalWidth === 0) return false
          const { top, left, bottom, right } = el.getBoundingClientRect()
          return (
            top >= 0 &&
            left >= 0 &&
            bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            right <= (window.innerWidth || document.documentElement.clientWidth)
          )
        })
        .map(el => el.decode())
    )
  )

const scrollFullPageToLoadContent = async (page, timeout) => {
  await page.evaluate(timeout => {
    return new Promise(resolve => {
      let totalHeight = 0
      const distance = Math.floor(window.innerHeight * 0.33)
      const waitForContent = () => {
        const startTime = Date.now()
        const checkContent = () => {
          const scrollHeight = document.body ? document.body.scrollHeight : 0
          const viewportHeight = window.innerHeight
          const elapsed = Date.now() - startTime

          if (scrollHeight > viewportHeight) {
            startScrolling()
          } else if (elapsed >= timeout / 2) {
            startScrolling()
          } else {
            setTimeout(checkContent, 50)
          }
        }
        checkContent()
      }

      const startScrolling = async () => {
        const scrollHeight = document.body.scrollHeight
        const expectedSteps = Math.ceil(scrollHeight / distance)
        const scrollDelay = timeout / 2 / expectedSteps
        while (totalHeight < document.body.scrollHeight) {
          window.scrollBy(0, distance)
          totalHeight += distance
          await new Promise(resolve => setTimeout(resolve, scrollDelay))
        }
        resolve()
      }

      waitForContent()
    })
  }, timeout)
  await page.evaluate(() => window.scrollTo(0, 0))
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

  return function screenshot (page) {
    return async (
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

      const beforeScreenshot = (response, isFullPage = false) => {
        const timeout = goto.timeouts.action(goto.timeouts.base(opts.timeout))
        const tasks = [
          {
            fn: () => page.evaluate('document.fonts.ready'),
            debug: 'beforeScreenshot:fontsReady'
          },
          {
            fn: () => waitForPrism(page, response, { codeScheme, ...opts }),
            debug: 'beforeScreenshot:waitForPrism'
          },
          {
            fn: () => waitForImagesOnViewport(page),
            debug: 'beforeScreenshot:waitForImagesOnViewport'
          }
        ]

        // Add full page scrolling for better content loading when taking full page screenshots
        if (isFullPage) {
          tasks.push({
            fn: () => scrollFullPageToLoadContent(page, timeout),
            debug: 'beforeScreenshot:scrollFullPageToLoadContent'
          })
        }

        return Promise.all(tasks.map(({ fn, ...opts }) => goto.run({ fn: fn(), ...opts, timeout })))
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

      page.on('dialog', dialog => pReflect(dialog.dismiss()))

      const timeScreenshot = timeSpan()

      if (waitUntil !== 'auto') {
        ;({ response } = await goto(page, { ...opts, url, waitUntil }))
        const [screenshotOpts] = await Promise.all([
          waitForElement(page, element),
          beforeScreenshot(response, !element && opts.fullPage !== false)
        ])
        screenshot = await page.screenshot({ ...opts, ...screenshotOpts })
        debug('screenshot', { waitUntil, duration: timeScreenshot() })
      } else {
        ;({ response } = await goto(page, { ...opts, url, waitUntil, waitUntilAuto }))
        async function waitUntilAuto (page, { response }) {
          const [screenshotOpts] = await Promise.all([
            waitForElement(page, element),
            beforeScreenshot(response, !element && opts.fullPage !== false)
          ])
          const { isWhite } = await takeScreenshot({ ...opts, ...screenshotOpts })
          debug('screenshot', { waitUntil, isWhite, duration: timeScreenshot() })
        }
      }

      return Object.keys(overlayOpts).length === 0
        ? screenshot
        : overlay(screenshot, { ...opts, ...overlayOpts, viewport: page.viewport() })
    }
  }
}

module.exports.isWhiteScreenshot = isWhiteScreenshot

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

const waitForDomStability = ({ idle, timeout } = {}) =>
  new Promise(resolve => {
    if (!document.body) return resolve({ status: 'no-body' })

    let lastChange = performance.now()
    const observer = new window.MutationObserver(() => {
      lastChange = performance.now()
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
      characterData: false
    })

    const deadline = performance.now() + timeout

    ;(function check () {
      const now = performance.now()
      if (now - lastChange >= idle) {
        observer.disconnect()
        return resolve({ status: 'idle' })
      }
      if (now >= deadline) {
        observer.disconnect()
        return resolve({ status: 'timeout' })
      }
      window.requestAnimationFrame(check)
    })()
  })

const scrollFullPageToLoadContent = async (page, timeout) => {
  const debug = require('debug-logfmt')('browserless:goto')

  const duration = debug.duration()
  const result = await page.evaluate(waitForDomStability, {
    idle: timeout / 2 / 2,
    timeout: timeout / 2
  })

  duration('waitForDomStability', result)

  await page.evaluate(timeout => {
    return new Promise(resolve => {
      let currentScrollPosition = 0
      const scrollStep = Math.floor(window.innerHeight)
      const pageHeight = document.body.scrollHeight
      const totalSteps = Math.ceil(pageHeight / scrollStep)
      const stepDelay = timeout / 2 / totalSteps
      const scrollNext = async () => {
        if (currentScrollPosition >= pageHeight) {
          resolve()
          return
        }
        window.scrollBy(0, scrollStep)
        currentScrollPosition += scrollStep
        setTimeout(scrollNext, stepDelay)
      }
      scrollNext()
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
      { codeScheme = 'atom-dark', overlay: overlayOpts = {}, waitUntil = 'auto', ...opts } = {}
    ) => {
      let screenshot
      let response

      const beforeScreenshot = async (page, response, { element, fullPage = false } = {}) => {
        const timeout = goto.timeouts.action(opts.timeout)

        let screenshotOpts = {}
        const tasks = [
          {
            fn: () => page.evaluate('document.fonts.ready'),
            debug: 'beforeScreenshot:fontsReady'
          },
          {
            fn: () => waitForImagesOnViewport(page),
            debug: 'beforeScreenshot:waitForImagesOnViewport'
          }
        ]

        if (codeScheme && response) {
          tasks.push({
            fn: () => waitForPrism(page, response, { codeScheme, ...opts }),
            debug: 'beforeScreenshot:waitForPrism'
          })
        }

        if (fullPage) {
          tasks.push({
            fn: () => scrollFullPageToLoadContent(page, timeout, goto),
            debug: 'beforeScreenshot:scrollFullPageToLoadContent'
          })
        } else if (element) {
          tasks.push({
            fn: async () => {
              screenshotOpts = await waitForElement(page, element)
            },
            debug: 'beforeScreenshot:waitForElement'
          })
        }

        await Promise.all(
          tasks.map(({ fn, ...opts }) =>
            goto.run({
              fn: fn(),
              ...opts,
              timeout: fullPage ? timeout * 2 : timeout
            })
          )
        )

        return screenshotOpts
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
        const screenshotOpts = await beforeScreenshot(page, response, opts)
        screenshot = await page.screenshot({ ...opts, ...screenshotOpts })
        debug('screenshot', { waitUntil, duration: timeScreenshot() })
      } else {
        ;({ response } = await goto(page, { ...opts, url, waitUntil, waitUntilAuto }))
        async function waitUntilAuto (page, { response }) {
          const screenshotOpts = await beforeScreenshot(page, response, opts)
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

'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const { isContextDestroyed } = require('@browserless/errors')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const isWhiteScreenshot = require('./is-white-screenshot')
const waitForPrism = require('./pretty')
const prettyTimeSpan = require('./time-span')
const overlay = require('./overlay')
const { waitForDomStability } = require('./wait-for-dom')
const { waitForReady, paintSignals } = require('./wait-for-ready')
const {
  waitForOverflowHeight,
  expandOverflow,
  scrollFullPageToLoadContent,
  prepareFullDocument
} = require('./prepare-full-document')

const timeSpan = require('@kikobeats/time-span')()

const captureWithNavigationRetry = async (capture, { page, goto, timeout }) => {
  const elapsed = timeSpan()
  while (true) {
    try {
      return await capture()
    } catch (error) {
      if (!isContextDestroyed(error) || elapsed() >= timeout) throw error
      debug('captureWithNavigationRetry', { error: error.message })
      await goto.waitUntilAuto(page, { timeout })
    }
  }
}

const getPageMeta = page =>
  page.evaluate(() => ({
    title: document.title || '',
    bodyText: document.body ? document.body.innerText || '' : '',
    url: window.location.href || ''
  }))

const defaultIsPageReady = ({ isWhite }) => !isWhite

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

// Puppeteer screenshot options only — goto/readiness fields must not be
// forwarded (and readiness probes must not write `--path`).
const toScreenshotOpts = (opts, overrides = {}) => {
  const {
    path,
    type,
    quality,
    omitBackground,
    encoding,
    captureBeyondViewport,
    fromSurface,
    optimizeForSpeed,
    clip,
    fullPage
  } = opts
  return {
    path,
    type,
    quality,
    omitBackground,
    encoding,
    captureBeyondViewport,
    fromSurface,
    optimizeForSpeed,
    clip,
    fullPage,
    ...overrides
  }
}

const SCREENSHOT_DEFAULT_OPTS = {
  codeScheme: 'atom-dark',
  overlay: {},
  waitUntil: 'auto',
  isPageReady: defaultIsPageReady
}

module.exports = ({ goto, ...gotoOpts }) => {
  goto = goto || createGoto(gotoOpts)

  return function screenshot (page) {
    return async (
      url,
      {
        codeScheme = SCREENSHOT_DEFAULT_OPTS.codeScheme,
        overlay: overlayOpts = SCREENSHOT_DEFAULT_OPTS.overlay,
        waitUntil = SCREENSHOT_DEFAULT_OPTS.waitUntil,
        isPageReady = SCREENSHOT_DEFAULT_OPTS.isPageReady,
        ...opts
      } = {}
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

        if (element && !fullPage) {
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
              timeout
            })
          )
        )

        return screenshotOpts
      }

      const takeScreenshot = async opts => {
        const timeout = goto.timeouts.action(opts.timeout)
        const elapsed = timeSpan()
        let retry = 0
        let isWhite = false
        let isReady = false
        let didHydrateScroll = false

        do {
          screenshot = await captureWithNavigationRetry(
            () =>
              page.screenshot(
                toScreenshotOpts(opts, opts.fullPage ? { fullPage: false, path: undefined } : {})
              ),
            { page, goto, timeout }
          )
          isWhite = await isWhiteScreenshot(screenshot)
          const pageMetaResult = await pReflect(getPageMeta(page))
          const pageMeta = pageMetaResult.isRejected ? {} : pageMetaResult.value
          const pageReadyResult = await pReflect(
            opts.isPageReady({
              page,
              response: opts.response,
              screenshot,
              isWhite,
              isWhiteScreenshot,
              ...pageMeta
            })
          )
          isReady = !pageReadyResult.isRejected && !!pageReadyResult.value

          if (isReady || elapsed() >= timeout) break

          const remaining = timeout - elapsed()
          if (opts.fullPage && !didHydrateScroll && !isWhite && remaining > 1000) {
            didHydrateScroll = true
            await pReflect(scrollFullPageToLoadContent(page, Math.min(remaining / 2, 8000)))
            debug('screenshot:hydrateScroll', { remaining })
          }

          retry += 1
          await goto.waitUntilAuto(page, { timeout })
        } while (!isReady)

        if (opts.fullPage) {
          const scrollTimeout =
            typeof goto.timeouts.goto === 'function'
              ? goto.timeouts.goto(opts.timeout)
              : goto.timeouts.action(opts.timeout)
          if (isReady) {
            await prepareFullDocument(page, { goto, timeout: scrollTimeout })
          }
          screenshot = await captureWithNavigationRetry(
            async () => {
              if (isReady) await pReflect(page.evaluate(expandOverflow))
              return page.screenshot(toScreenshotOpts(opts, { fullPage: true }))
            },
            { page, goto, timeout: scrollTimeout }
          )
          isWhite = await isWhiteScreenshot(screenshot)
        }

        return { isWhite, isReady, retry }
      }

      const onDialog = dialog => pReflect(dialog.dismiss())
      page.on('dialog', onDialog)

      try {
        const timeScreenshot = prettyTimeSpan()

        if (waitUntil !== 'auto') {
          ;({ response } = await goto(page, { ...opts, url, waitUntil }))
          const screenshotOpts = await beforeScreenshot(page, response, opts)
          if (opts.fullPage) {
            const scrollTimeout =
              typeof goto.timeouts.goto === 'function'
                ? goto.timeouts.goto(opts.timeout)
                : goto.timeouts.action(opts.timeout)
            await prepareFullDocument(page, { goto, timeout: scrollTimeout })
          }
          screenshot = await captureWithNavigationRetry(
            async () => {
              if (opts.fullPage) await pReflect(page.evaluate(expandOverflow))
              return page.screenshot(toScreenshotOpts({ ...opts, ...screenshotOpts }))
            },
            { page, goto, timeout: goto.timeouts.action(opts.timeout) }
          )
          debug('screenshot', { waitUntil, duration: timeScreenshot() })
        } else {
          ;({ response } = await goto(page, { ...opts, url, waitUntil, waitUntilAuto }))
          async function waitUntilAuto (page, { response }) {
            const screenshotOpts = await beforeScreenshot(page, response, opts)
            const { isWhite, isReady, retry } = await takeScreenshot({
              ...opts,
              ...screenshotOpts,
              isPageReady,
              response
            })
            debug('screenshot', {
              waitUntil,
              isReady,
              isWhite,
              retry,
              duration: timeScreenshot()
            })
          }
        }

        return Object.keys(overlayOpts).length === 0
          ? screenshot
          : overlay(screenshot, { ...opts, ...overlayOpts, viewport: page.viewport() })
      } finally {
        page.off('dialog', onDialog)
      }
    }
  }
}

module.exports.captureWithNavigationRetry = captureWithNavigationRetry
module.exports.isWhiteScreenshot = isWhiteScreenshot
module.exports.waitForDomStability = waitForDomStability
module.exports.waitForReady = waitForReady
module.exports.paintSignals = paintSignals
module.exports.scrollFullPageToLoadContent = scrollFullPageToLoadContent
module.exports.waitForOverflowHeight = waitForOverflowHeight
module.exports.expandOverflow = expandOverflow
module.exports.prepareFullDocument = prepareFullDocument
module.exports.SCREENSHOT_DEFAULT_OPTS = SCREENSHOT_DEFAULT_OPTS

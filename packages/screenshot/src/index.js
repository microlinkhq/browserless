'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const isWhiteScreenshot = require('./is-white-screenshot')
const waitForPrism = require('./pretty')
const timeSpan = require('./time-span')
const overlay = require('./overlay')
const { waitForDomStability, resolveWaitForDom, DEFAULT_WAIT_FOR_DOM } = require('./wait-for-dom')

const createElapsed = () => {
  const start = Date.now()
  return () => Date.now() - start
}

const getPageSnapshot = page =>
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

const scrollFullPageToLoadContent = async (page, timeout) => {
  const debug = require('debug-logfmt')('browserless:goto')

  const duration = debug.duration()
  const result = await page.evaluate(waitForDomStability, {
    idle: timeout / 2 / 2,
    timeout: timeout / 2
  })

  duration('waitForDomStability', result)

  await page.evaluate(
    timeout =>
      new Promise(resolve => {
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
      }),
    timeout
  )
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
        codeScheme = 'atom-dark',
        overlay: overlayOpts = {},
        waitUntil = 'auto',
        waitForDom = DEFAULT_WAIT_FOR_DOM,
        isPageReady = defaultIsPageReady,
        ...opts
      } = {}
    ) => {
      let screenshot
      let response

      const beforeScreenshot = async (page, response, { element, fullPage = false } = {}) => {
        const timeout = goto.timeouts.action(opts.timeout)
        const waitForDomOpts = resolveWaitForDom(waitForDom)

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

        if (waitForDomOpts) {
          tasks.push({
            fn: () => page.evaluate(waitForDomStability, waitForDomOpts),
            debug: 'beforeScreenshot:waitForDomStability'
          })
        }

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
        const timeout = goto.timeouts.action(opts.timeout)
        const elapsed = createElapsed()
        let retry = 0
        let isWhite = false
        let isReady = false

        do {
          screenshot = await page.screenshot(opts)
          isWhite = await isWhiteScreenshot(screenshot)
          const snapshotResult = await pReflect(getPageSnapshot(page))
          const pageSnapshot = snapshotResult.isRejected ? {} : snapshotResult.value
          const pageReadyResult = await pReflect(
            opts.isPageReady({
              page,
              response: opts.response,
              screenshot,
              isWhite,
              isWhiteScreenshot,
              ...pageSnapshot
            })
          )
          isReady = !pageReadyResult.isRejected && !!pageReadyResult.value

          if (isReady || elapsed() >= timeout) break

          retry += 1
          await goto.waitUntilAuto(page, { timeout })
        } while (!isReady)

        return { isWhite, isReady, retry }
      }

      const onDialog = dialog => pReflect(dialog.dismiss())
      page.on('dialog', onDialog)

      try {
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

module.exports.isWhiteScreenshot = isWhiteScreenshot
module.exports.waitForDomStability = waitForDomStability
module.exports.resolveWaitForDom = resolveWaitForDom
module.exports.DEFAULT_WAIT_FOR_DOM = DEFAULT_WAIT_FOR_DOM

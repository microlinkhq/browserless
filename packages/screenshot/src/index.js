'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const { isContextDestroyed } = require('@browserless/errors')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const isWhiteScreenshot = require('./is-white-screenshot')
const waitForPrism = require('./pretty')
const prettyTimeSpan = require('./time-span')
const overlay = require('./overlay')
const { waitForDomStability, resolveWaitForDom, DEFAULT_WAIT_FOR_DOM } = require('./wait-for-dom')
const { waitForReady, snapshot } = require('./wait-for-ready')

const timeSpan = require('@kikobeats/time-span')()

// Retry a page capture (screenshot/pdf) that races with a client-side
// navigation. When the execution context is destroyed mid-capture, the page is
// navigating: wait for it to settle via `waitUntilAuto` and retry in-place,
// bounded by `timeout`, rather than failing the whole request. SPAs (e.g.
// scribd) navigate client-side after load, so the initial capture often races.
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

// Walk the page (window, or the tallest overflow scroller when the document
// itself isn't tall — report viewers / app shells) so lazy sections and
// intersection-observer fetches actually run before capture/print.
const scrollFullPageToLoadContent = async (page, timeout) => {
  const debug = require('debug-logfmt')('browserless:goto')
  const duration = debug.duration()

  // Most of the budget goes to scrolling: each step needs dwell time for
  // intersection-observer fetches. A short pre-scroll quiet is enough to avoid
  // racing a still-mounting shell; the post-scroll quiet waits for skeletons
  // to be swapped out.
  const preQuiet = Math.min(500, Math.floor(timeout / 8))
  const postQuiet = Math.min(Math.floor(timeout / 4), Math.floor((timeout - preQuiet) / 2))
  const scrollBudget = Math.max(0, timeout - preQuiet - postQuiet)

  if (preQuiet > 0) {
    const result = await page.evaluate(waitForDomStability, {
      idle: preQuiet / 2,
      timeout: preQuiet
    })
    duration('waitForDomStability:pre', result)
  }

  await page.evaluate(
    scrollBudget =>
      new Promise(resolve => {
        const doc = document.scrollingElement || document.documentElement
        let root = null
        let pageHeight = doc ? doc.scrollHeight : 0
        let viewport = window.innerHeight

        // Document isn't scrollable: prefer the tallest overflow scroller
        // (e.g. `.report-canvas-scroll`) so below-fold slides still hydrate.
        if (pageHeight <= viewport + 1 && document.body) {
          let best = null
          for (const el of document.body.querySelectorAll('*')) {
            if (el.scrollHeight <= el.clientHeight + 20) continue
            const { overflowY } = window.getComputedStyle(el)
            if (overflowY !== 'auto' && overflowY !== 'scroll') continue
            if (!best || el.scrollHeight > best.scrollHeight) best = el
          }
          if (best) {
            root = best
            pageHeight = best.scrollHeight
            viewport = best.clientHeight
          }
        }

        let currentScrollPosition = 0
        const scrollStep = Math.max(1, Math.floor(viewport * 0.8))
        const totalSteps = Math.max(1, Math.ceil(pageHeight / scrollStep))
        // Floor dwell so lazy sections actually fetch; if the budget can't
        // cover every step at that pace, steps stretch to fit the budget.
        const stepDelay = Math.max(400, Math.floor(scrollBudget / totalSteps))
        const reset = () => {
          window.scrollTo(0, 0)
          if (root) root.scrollTop = 0
          resolve()
        }
        const scrollNext = () => {
          if (currentScrollPosition >= pageHeight) return reset()
          if (root) root.scrollBy(0, scrollStep)
          else window.scrollBy(0, scrollStep)
          currentScrollPosition += scrollStep
          setTimeout(scrollNext, stepDelay)
        }
        scrollNext()
      }),
    scrollBudget
  )

  if (postQuiet > 0) {
    const result = await page.evaluate(waitForDomStability, {
      idle: Math.min(300, postQuiet / 2),
      timeout: postQuiet
    })
    duration('waitForDomStability:post', result)
  }
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

const SCREENSHOT_DEFAULT_OPTS = {
  codeScheme: 'atom-dark',
  overlay: {},
  waitUntil: 'auto',
  waitForDom: DEFAULT_WAIT_FOR_DOM,
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
        waitForDom = SCREENSHOT_DEFAULT_OPTS.waitForDom,
        isPageReady = SCREENSHOT_DEFAULT_OPTS.isPageReady,
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
        const elapsed = timeSpan()
        let retry = 0
        let isWhite = false
        let isReady = false

        do {
          screenshot = await captureWithNavigationRetry(() => page.screenshot(opts), {
            page,
            goto,
            timeout
          })
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
        const timeScreenshot = prettyTimeSpan()

        if (waitUntil !== 'auto') {
          ;({ response } = await goto(page, { ...opts, url, waitUntil }))
          const screenshotOpts = await beforeScreenshot(page, response, opts)
          screenshot = await captureWithNavigationRetry(
            () => page.screenshot({ ...opts, ...screenshotOpts }),
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
module.exports.resolveWaitForDom = resolveWaitForDom
module.exports.waitForReady = waitForReady
module.exports.snapshot = snapshot
module.exports.scrollFullPageToLoadContent = scrollFullPageToLoadContent
module.exports.SCREENSHOT_DEFAULT_OPTS = SCREENSHOT_DEFAULT_OPTS

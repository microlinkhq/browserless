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
const { waitForReady } = require('./wait-for-ready')

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

// A pane counts as its own scroller once it overflows by more than this. Small
// overflows are scrollbar-rounding noise, not content worth walking.
const MIN_SCROLLER_OVERFLOW = 50

// Longest single wait after the walk. The walk only fires the intersections;
// what they request lands during this settle, and the requests resolve in
// parallel with each other, so one wait covers all of them.
const SCROLL_SETTLE_MAX = 1000

// Reveal content the page defers until it is scrolled into view, then wait once
// while what that triggered loads.
//
// Two things this does that walking `window` alone does not:
//
// Inner panes. Not every app scrolls the document. A full-height `overflow:auto`
// pane — dashboards, report viewers — leaves `document.body.scrollHeight` at the
// viewport forever, so scrolling the window is a no-op and nothing is ever
// revealed. Measured on a report whose scroller was an inner div: 120 skeleton
// placeholders before, 0 after. Scrollers are walked together rather than one
// after another, so a page with several panes costs the same as its deepest.
//
// No pause between steps. Pausing serialized work the browser already does
// concurrently: the requests one step fires resolve while the next steps run.
// Touching each position as fast as the clock allows and settling once produced
// identical output far quicker — a report walked in 770ms instead of 6.1s, and
// 40 native lazy images decoded in 1.2s instead of 6.0s, both complete either
// way. `timeout` is now a backstop for a page that never finishes, not the pace.
const scrollToLoadContent = async (page, timeout) =>
  page.evaluate(
    async ({ timeout, settleMax, minOverflow }) => {
      const tick = () => new Promise(resolve => setTimeout(resolve, 16))

      const scrollers = [
        {
          extent: () => document.body.scrollHeight,
          step: () => window.innerHeight,
          to: y => window.scrollTo(0, y)
        },
        ...[...document.querySelectorAll('*')]
          .filter(element => {
            const { overflowY } = window.getComputedStyle(element)
            return (
              /auto|scroll/.test(overflowY) &&
              element.scrollHeight > element.clientHeight + minOverflow
            )
          })
          .map(element => ({
            extent: () => element.scrollHeight,
            step: () => element.clientHeight,
            to: y => {
              element.scrollTop = y
            }
          }))
      ]

      const deadline = Date.now() + timeout

      await Promise.all(
        scrollers.map(async scroller => {
          const step = Math.max(1, scroller.step())
          // `extent` is re-read every turn: revealing content can lengthen the
          // very thing being walked, and a length captured up front would stop
          // short of whatever the walk itself added.
          for (let y = 0; y < scroller.extent() && Date.now() < deadline; y += step) {
            scroller.to(y)
            await tick()
          }
          scroller.to(0)
        })
      )

      await new Promise(resolve =>
        setTimeout(resolve, Math.max(0, Math.min(settleMax, deadline - Date.now())))
      )
    },
    { timeout, settleMax: SCROLL_SETTLE_MAX, minOverflow: MIN_SCROLLER_OVERFLOW }
  )

const scrollFullPageToLoadContent = async (page, timeout) => {
  const debug = require('debug-logfmt')('browserless:goto')

  const duration = debug.duration()
  const result = await page.evaluate(waitForDomStability, {
    idle: timeout / 2 / 2,
    timeout: timeout / 2
  })

  duration('waitForDomStability', result)

  await scrollToLoadContent(page, timeout)
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
module.exports.scrollFullPageToLoadContent = scrollFullPageToLoadContent
module.exports.scrollToLoadContent = scrollToLoadContent
module.exports.SCREENSHOT_DEFAULT_OPTS = SCREENSHOT_DEFAULT_OPTS

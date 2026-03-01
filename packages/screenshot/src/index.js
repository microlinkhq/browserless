'use strict'

const { setTimeout: delay } = require('node:timers/promises')

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const isWhiteScreenshot = require('./is-white-screenshot')
const waitForPrism = require('./pretty')
const timeSpan = require('./time-span')
const overlay = require('./overlay')

const MAX_WHITE_RETRIES = 5
const VERIFICATION_RETRY_DELAY = 50
const VERIFICATION_MARKERS = Object.freeze([
  'verifying you are human',
  'please wait while we verify that you are',
  'security check',
  'checking your browser',
  'request has been denied by the security policy',
  'vercel security checkpoint',
  '/_vercel/challenge'
])

const isVerificationSnapshot = ({ title = '', bodyText = '', url = '' } = {}) => {
  const haystack = `${title}\n${bodyText}\n${url}`.toLowerCase()
  return VERIFICATION_MARKERS.some(marker => haystack.includes(marker))
}

const createElapsed = () => {
  const start = Date.now()
  return () => Date.now() - start
}

const getVerificationSnapshot = page =>
  page.evaluate(() => ({
    title: document.title || '',
    bodyText: document.body ? document.body.innerText || '' : '',
    url: window.location.href || ''
  }))

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
      attributes: true,
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
      { codeScheme = 'atom-dark', overlay: overlayOpts = {}, waitUntil = 'auto', ...opts } = {}
    ) => {
      let screenshot
      let response

      const beforeScreenshot = async (page, response, { element, fullPage = false } = {}) => {
        const timeout = goto.timeouts.action(opts.timeout)
        const domStabilityTimeout = Math.max(500, Math.min(4000, timeout))

        let screenshotOpts = {}
        const tasks = [
          {
            fn: () =>
              page.evaluate(waitForDomStability, {
                idle: Math.max(200, Math.floor(domStabilityTimeout / 4)),
                timeout: domStabilityTimeout
              }),
            debug: 'beforeScreenshot:waitForDomStability'
          },
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
        const timeout = goto.timeouts.action(opts.timeout)
        const elapsed = createElapsed()
        let retry = 0
        let isWhite = false

        do {
          screenshot = await page.screenshot(opts)
          isWhite = await isWhiteScreenshot(screenshot)

          if (!isWhite || retry >= MAX_WHITE_RETRIES || elapsed() >= timeout) break

          retry += 1
          await goto.waitUntilAuto(page, { timeout })
        } while (isWhite)

        return { isWhite, retry }
      }

      const waitForVerificationToResolve = async opts => {
        const timeout = goto.timeouts.goto(opts.timeout)
        const elapsed = createElapsed()
        let retry = 0
        let isPending = false

        do {
          const snapshotResult = await pReflect(getVerificationSnapshot(page))
          isPending = !snapshotResult.isRejected && isVerificationSnapshot(snapshotResult.value)

          if (!isPending || elapsed() >= timeout) break

          retry += 1
          const remaining = Math.max(1, timeout - elapsed())
          const waitTimeout = Math.min(2000, remaining)
          await pReflect(goto.waitUntilAuto(page, { timeout: waitTimeout }))
          await delay(Math.min(VERIFICATION_RETRY_DELAY, remaining))
        } while (isPending)

        return { isPending, retry }
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
            const verification = await waitForVerificationToResolve(opts)
            const screenshotOpts = await beforeScreenshot(page, response, opts)
            const { isWhite, retry } = await takeScreenshot({ ...opts, ...screenshotOpts })
            debug('screenshot', {
              waitUntil,
              isWhite,
              retry,
              verificationRetry: verification.retry,
              verificationPending: verification.isPending,
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
module.exports.MAX_WHITE_RETRIES = MAX_WHITE_RETRIES
module.exports.VERIFICATION_MARKERS = VERIFICATION_MARKERS
module.exports.isVerificationSnapshot = isVerificationSnapshot

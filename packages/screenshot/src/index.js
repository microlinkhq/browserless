'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const { extname } = require('node:path')
const pReflect = require('p-reflect')

const isTransientContextLoss = require('./is-transient-context-loss')
const isWhiteScreenshot = require('./is-white-screenshot')
const { evaluateIsolated } = require('./evaluate-isolated')
const waitForPrism = require('./pretty')
const prettyTimeSpan = require('./time-span')
const overlay = require('./overlay')
const { waitForDomStability } = require('./wait-for-dom')
const { waitForReady, paintSignals } = require('./wait-for-ready')
const {
  expandOverflow,
  scrollFullPageToLoadContent,
  prepareFullDocument,
  resolveScrollTimeout,
  tryHydrateScroll
} = require('./prepare-full-document')

const timeSpan = require('@kikobeats/time-span')()

const ELEMENT_CLIP_ATTEMPTS = 2

// No pacing here on purpose: `waitUntilAuto` is a network-idle wait, which on a
// live page costs at least its idle window (~500ms) and at most what is left of
// the budget. The runaway case was never a fast loop — it was retrying a page
// that was gone, where the wait returns instantly. Classify that and the loop
// paces itself on real work.
const captureWithNavigationRetry = async (capture, { page, goto, timeout }) => {
  const elapsed = timeSpan()
  const remaining = () => timeout - elapsed()
  while (true) {
    try {
      return await capture()
    } catch (error) {
      if (!isTransientContextLoss(page, error) || remaining() <= 0) throw error
      debug('captureWithNavigationRetry', { error: error.message })
      await goto.waitUntilAuto(page, { timeout: remaining(), credit: false })
      if (remaining() <= 0) throw error
    }
  }
}

const getPageMeta = page =>
  evaluateIsolated(page, () => ({
    title: document.title || '',
    bodyText: document.body ? document.body.innerText || '' : '',
    url: window.location.href || ''
  }))

const defaultIsPageReady = ({ isWhite }) => !isWhite

const checkPageReady = async (page, { isPageReady, response, screenshot, isWhite } = {}) => {
  let pageMeta = {}
  if (isPageReady !== defaultIsPageReady) {
    const pageMetaResult = await pReflect(getPageMeta(page))
    pageMeta = pageMetaResult.isRejected ? {} : pageMetaResult.value
  }
  const pageReadyResult = await pReflect(
    isPageReady({ page, response, screenshot, isWhite, isWhiteScreenshot, ...pageMeta })
  )
  return !pageReadyResult.isRejected && !!pageReadyResult.value
}

const waitForImagesOnViewport = page =>
  evaluateIsolated(page, () =>
    Promise.all(
      Array.from(document.querySelectorAll('img[src]:not([aria-hidden="true"])'))
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

/**
 * In-viewport image that has a layout box but has not decoded yet: a skeleton,
 * or a lazy `src` that an intersection observer has not assigned. A finished
 * broken image (`complete` with no pixels) is not pending — waiting will not
 * load it.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<boolean>}
 */
const pendingViewportImages = page =>
  evaluateIsolated(page, () => {
    const viewH = window.innerHeight || document.documentElement.clientHeight
    const viewW = window.innerWidth || document.documentElement.clientWidth
    for (const el of document.querySelectorAll('img:not([aria-hidden="true"])')) {
      const { top, left, bottom, right, width, height } = el.getBoundingClientRect()
      if (width < 32 || height < 32) continue
      if (bottom <= 0 || right <= 0 || top >= viewH || left >= viewW) continue
      const src = el.currentSrc || el.getAttribute('src') || ''
      const lazy =
        el.getAttribute('data-src') ||
        el.getAttribute('data-srcset') ||
        el.getAttribute('data-lazy-src')
      const placeholder = src === '' || src.startsWith('data:')
      if (placeholder && lazy) return true
      if ((el.naturalWidth === 0 || el.naturalHeight === 0) && !el.complete) return true
    }
    return false
  })

/**
 * One viewport of scroll and back, so an intersection observer on a hero
 * requests its asset before the readiness check. The document is stretched
 * for the gesture when the page itself does not overflow.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
const nudgeViewport = page =>
  evaluateIsolated(
    page,
    () =>
      new Promise(resolve => {
        const root = document.scrollingElement || document.documentElement
        const previous = root.style.height
        const y = window.scrollY
        root.style.height = `${(window.innerHeight || 800) * 3}px`
        window.scrollTo(0, window.innerHeight || 800)
        window.requestAnimationFrame(() => {
          window.scrollTo(0, y)
          window.requestAnimationFrame(() => {
            root.style.height = previous
            resolve()
          })
        })
      })
  )

const readElementClip = async (page, element) => {
  const handle = await page.waitForSelector(element, { visible: true })
  try {
    return await handle.boundingBox()
  } finally {
    await handle.dispose()
  }
}

const waitForElement = async (page, element, screenshotOpts) => {
  for (let attempt = 0; attempt < ELEMENT_CLIP_ATTEMPTS; attempt++) {
    screenshotOpts.clip = await readElementClip(page, element)
    if (screenshotOpts.clip !== null) break
  }
  screenshotOpts.fullPage = false
}

const SCREENSHOT_DEFAULT_OPTS = {
  codeScheme: 'atom-dark',
  overlay: {},
  waitUntil: 'auto',
  isPageReady: defaultIsPageReady
}

const LOSSY_TYPES = new Set(['jpeg', 'webp'])
const LOSSY_EXTENSIONS = new Set(['.jpg', '.jpeg', '.webp'])

const isLossy = ({ type, path }) =>
  type !== undefined
    ? LOSSY_TYPES.has(type)
    : LOSSY_EXTENSIONS.has(extname(path ?? '').toLowerCase())

// Captures stay binary until returned: the blank-page check and the overlay
// decode them with sharp, which reads a base64 string as raw bytes.
const encodeScreenshot = (image, encoding) =>
  encoding === 'base64' && ArrayBuffer.isView(image)
    ? Buffer.from(image.buffer, image.byteOffset, image.byteLength).toString('base64')
    : image

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
        encoding,
        ...opts
      } = {}
    ) => {
      if (opts.quality !== undefined && !isLossy(opts)) opts.quality = undefined

      let screenshot
      let response

      const captureExpanded = (expand, screenshotOpts, timeout) =>
        captureWithNavigationRetry(
          async () => {
            if (expand) await pReflect(expandOverflow(page))
            return page.screenshot(screenshotOpts)
          },
          { page, goto, timeout }
        )

      const beforeScreenshot = async (page, response, { element, fullPage = false } = {}) => {
        const timeout = goto.timeouts.action(opts.timeout)

        const screenshotOpts = {}
        const tasks = [
          {
            fn: () => evaluateIsolated(page, 'document.fonts.ready'),
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
            fn: () => waitForElement(page, element, screenshotOpts),
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

        if (screenshotOpts.clip === null) {
          throw new Error(`Element \`${element}\` detached before its clip could be read`)
        }

        return screenshotOpts
      }

      const takeScreenshot = async opts => {
        const timeout = goto.timeouts.action(opts.timeout)
        const elapsed = timeSpan()
        let retry = 0
        let isWhite = false
        let isReady = false
        let didHydrateScroll = false
        let didHydrateAttempt = false

        await pReflect(nudgeViewport(page))

        do {
          screenshot = await captureWithNavigationRetry(
            () => {
              if (!opts.fullPage) return page.screenshot(opts)
              const { fullPage, path, quality, ...probeOpts } = opts
              return page.screenshot({ ...probeOpts, fullPage: false })
            },
            { page, goto, timeout }
          )
          isWhite = await isWhiteScreenshot(screenshot)
          isReady = await checkPageReady(page, {
            isPageReady: opts.isPageReady,
            response: opts.response,
            screenshot,
            isWhite
          })

          if (isReady) {
            const pending = await pReflect(pendingViewportImages(page))
            if (!pending.isRejected && pending.value) isReady = false
          }

          if (isReady || elapsed() >= timeout) break

          const remaining = timeout - elapsed()
          if (opts.fullPage && !didHydrateAttempt) {
            didHydrateAttempt = true
            const { hydrated, info } = await tryHydrateScroll(page, remaining)
            didHydrateScroll = hydrated
            debug('screenshot:hydrateScroll', { remaining, hydrated, ...info })
          }

          const idleTimeout = timeout - elapsed()
          if (idleTimeout <= 0) break

          retry += 1
          await goto.waitUntilAuto(page, { timeout: idleTimeout, credit: false })
        } while (!isReady)

        if (opts.fullPage) {
          if (isReady) {
            await prepareFullDocument(page, {
              goto,
              timeout: opts.timeout,
              scrolled: didHydrateScroll
            })
          }
          screenshot = await captureExpanded(
            isReady,
            { ...opts, fullPage: true },
            resolveScrollTimeout(goto, opts.timeout)
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
            await prepareFullDocument(page, { goto, timeout: opts.timeout })
          }
          screenshot = await captureExpanded(
            opts.fullPage,
            { ...opts, ...screenshotOpts },
            goto.timeouts.action(opts.timeout)
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

        const image =
          Object.keys(overlayOpts).length === 0
            ? screenshot
            : await overlay(screenshot, { ...opts, ...overlayOpts, viewport: page.viewport() })
        return encodeScreenshot(image, encoding)
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
module.exports.expandOverflow = expandOverflow
module.exports.getPageMeta = getPageMeta
module.exports.checkPageReady = checkPageReady
module.exports.tryHydrateScroll = tryHydrateScroll
module.exports.resolveScrollTimeout = resolveScrollTimeout
module.exports.prepareFullDocument = prepareFullDocument
module.exports.SCREENSHOT_DEFAULT_OPTS = SCREENSHOT_DEFAULT_OPTS

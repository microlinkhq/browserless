'use strict'

const timeSpan = require('@kikobeats/time-span')({ format: n => Math.round(n) })
const debug = require('debug-logfmt')('browserless:pdf')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const {
  captureWithNavigationRetry,
  isWhiteScreenshot,
  waitForDomStability,
  waitForReady,
  prepareFullDocument,
  expandOverflow,
  scrollFullPageToLoadContent,
  resolveWaitForDom,
  SCREENSHOT_DEFAULT_OPTS
} = require('@browserless/screenshot')

const PDF_DEFAULT_OPTS = {
  waitForDom: SCREENSHOT_DEFAULT_OPTS.waitForDom,
  margin: '0.35cm',
  scale: 0.65,
  printBackground: true,
  waitUntil: 'auto',
  isPageReady: SCREENSHOT_DEFAULT_OPTS.isPageReady
  // mediaType intentionally unset: `page.pdf()` already uses Chromium print
  // CSS. Pass `mediaType: 'screen' | 'print'` to call emulateMediaType.
}

// Share of the phase's load allowance the readiness gate may consume in `auto`
// mode. Pages observed settling in 0.6-3.3s (a hydrating document is the slow
// end), so a quarter of the allowance — ~3.9s at the default request budget —
// covers them with margin while keeping the cap well short of the render's
// share. The gate returns as soon as the page is quiet, so this bounds only a
// page that never settles.
const READY_BUDGET_RATIO = 0.25

// Minimum visible characters for the text fast path. Matches the counting cap
// in `waitForReady`'s paintSignals, which stops walking text nodes once reached —
// raising this above the cap would make the text fast path unreachable.
const TEXT_PAINTED_MIN = 200

// Puppeteer `page.pdf()` options only — keep navigation/readiness keys out of
// the CDP payload even though unknown keys are usually ignored.
const toPdfOpts = ({
  path,
  scale,
  displayHeaderFooter,
  headerTemplate,
  footerTemplate,
  printBackground,
  landscape,
  pageRanges,
  format,
  width,
  height,
  preferCSSPageSize,
  margin,
  omitBackground,
  tagged,
  outline,
  waitForFonts,
  timeout
}) =>
  Object.fromEntries(
    Object.entries({
      path,
      scale,
      displayHeaderFooter,
      headerTemplate,
      footerTemplate,
      printBackground,
      landscape,
      pageRanges,
      format,
      width,
      height,
      preferCSSPageSize,
      margin: getMargin(margin),
      omitBackground,
      tagged,
      outline,
      waitForFonts,
      timeout
    }).filter(([, value]) => value !== undefined)
  )

const getMargin = unit => {
  if (!unit) return unit
  if (typeof unit === 'object') return unit
  return {
    top: unit,
    right: unit,
    bottom: unit,
    left: unit
  }
}

const getPageSnapshot = page =>
  page.evaluate(() => ({
    title: document.title || '',
    bodyText: document.body ? document.body.innerText || '' : '',
    url: window.location.href || ''
  }))

const isPaintedContent = ({ painted = 0, text = 0, fonts = true } = {}) =>
  painted > 0 || (text >= TEXT_PAINTED_MIN && fonts)

const resolveScrollTimeout = (goto, timeout) =>
  typeof goto.timeouts.goto === 'function'
    ? goto.timeouts.goto(timeout)
    : goto.timeouts.action(timeout)

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  // Render an already-prepared page to a PDF buffer. Split out from the load so
  // a single load can be reused across page-range chunks (microlink-api's
  // parallel renderer) without re-navigating.
  const render = async (page, opts = {}) => {
    const pdfOpts = toPdfOpts({
      ...opts,
      margin: opts.margin ?? PDF_DEFAULT_OPTS.margin,
      scale: opts.scale ?? PDF_DEFAULT_OPTS.scale,
      printBackground: opts.printBackground ?? PDF_DEFAULT_OPTS.printBackground
    })

    await pReflect(page.evaluate(expandOverflow))

    return captureWithNavigationRetry(() => page.pdf(pdfOpts), {
      page,
      goto,
      timeout: goto.timeouts.action(opts.timeout)
    })
  }

  // Navigate `page` to `url` and wait until it is ready to print: DOM stability
  // plus, in `auto` mode, a navigation-tolerant readiness gate. Only a page that
  // settles still-blank falls back to the (expensive, navigation-fragile)
  // screenshot poll.
  const prepare = async (page, url, opts = {}) => {
    const {
      margin,
      scale,
      printBackground,
      // Unset → Chromium's native print CSS for `page.pdf()`. Pass `screen` (or
      // another type) via opts when the caller needs emulateMediaType.
      mediaType,
      waitUntil = PDF_DEFAULT_OPTS.waitUntil,
      waitForDom = PDF_DEFAULT_OPTS.waitForDom,
      isPageReady = PDF_DEFAULT_OPTS.isPageReady,
      ...rest
    } = opts
    const waitForDomOpts = resolveWaitForDom(waitForDom)
    const gotoOpts = { ...rest, mediaType }

    const waitForDomStabilityResult = async page => {
      if (!waitForDomOpts) return

      const result = await pReflect(page.evaluate(waitForDomStability, waitForDomOpts))
      debug(
        'waitForDomStability',
        result.isRejected
          ? { ...waitForDomOpts, error: result.reason.message || result.reason }
          : { ...waitForDomOpts, ...result.value }
      )
    }

    const checkPageReady = async (page, { response, screenshot, isWhite } = {}) => {
      const pageSnapshot = await pReflect(getPageSnapshot(page))
      const pageMeta = pageSnapshot.isRejected ? {} : pageSnapshot.value
      const pageReadyResult = await pReflect(
        isPageReady({
          page,
          response,
          screenshot,
          isWhite,
          isWhiteScreenshot,
          ...pageMeta
        })
      )
      return !pageReadyResult.isRejected && !!pageReadyResult.value
    }

    if (waitUntil !== 'auto') {
      await goto(page, { ...gotoOpts, url, waitUntil })
      await waitForDomStabilityResult(page)
      return
    }

    // Surfaced to the caller: a page whose readiness could not be confirmed
    // (`timedOut`) is a poor one to keep rendering on, so a caller reusing this
    // load across page-ranges can choose a fresh context instead.
    let readiness
    let isReady = false

    await goto(page, { ...gotoOpts, url, waitUntil, waitUntilAuto })

    // Same full-document prep as fullPage screenshot (scroll + unwrap overflow).
    if (isReady) {
      const prep = await prepareFullDocument(page, {
        goto,
        timeout: resolveScrollTimeout(goto, rest.timeout)
      })
      readiness = { ...readiness, ...prep }
    }

    return readiness

    async function waitUntilAuto (page, { response, timeout: autoTimeout } = {}) {
      await waitForDomStabilityResult(page)
      const timeout = autoTimeout ?? goto.timeouts.action(rest.timeout)

      const readyTime = timeSpan()
      const ready = await waitForReady(page, {
        timeout: Math.round(timeout * READY_BUDGET_RATIO)
      })
      readiness = ready
      debug('ready', { ...ready, duration: readyTime() })

      const elapsed = timeSpan()
      const pollTimeout = Math.max(0, timeout - readyTime())
      let hydrated = false

      // Painted-content fast path still must clear `isPageReady` (bot-check /
      // verification). Prefer a page-meta check without a probe shot.
      isReady =
        !ready.timedOut &&
        isPaintedContent(ready) &&
        !ready.covered &&
        ready.viewport > 0 &&
        ready.height > ready.viewport

      if (isReady) {
        isReady = await checkPageReady(page, { response, isWhite: false })
        if (!isReady) debug('ready:isPageReady', { rejected: true })
      }

      if (!isReady) {
        let retry = -1
        do {
          ++retry
          const screenshotTime = timeSpan()
          const screenshot = await captureWithNavigationRetry(
            () =>
              page.screenshot({
                optimizeForSpeed: true,
                type: 'jpeg',
                quality: 30
              }),
            { page, goto, timeout: Math.max(0, pollTimeout - elapsed()) }
          )
          const isWhite = await isWhiteScreenshot(screenshot)
          isReady = await checkPageReady(page, { response, screenshot, isWhite })

          // One bounded scroll so overflow/lazy shells can paint before the
          // next readiness check — without waiting for a final prepare gate.
          const remaining = pollTimeout - elapsed()
          if (!isReady && !hydrated && !isWhite && remaining > 1000) {
            hydrated = true
            await pReflect(scrollFullPageToLoadContent(page, Math.min(remaining / 2, 8000)))
            debug('ready:hydrateScroll', { remaining })
          }

          if (!isReady) await goto.waitUntilAuto(page, { timeout: rest.timeout })
          debug('retry', {
            waitUntil,
            isReady,
            isWhite,
            retry,
            duration: screenshotTime()
          })
        } while (!isReady && elapsed() < pollTimeout)
      }

      debug({ waitUntil, isReady, timeout: pollTimeout, duration: require('pretty-ms')(elapsed()) })
    }
  }

  const pdf =
    page =>
      async (url, opts = {}) => {
        await prepare(page, url, opts)
        return render(page, opts)
      }

  pdf.prepare = prepare
  pdf.render = render
  return pdf
}

module.exports.DEFAULT_OPTS = PDF_DEFAULT_OPTS

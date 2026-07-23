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

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  // Render an already-prepared page to a PDF buffer. Split out from the load so
  // a single load can be reused across page-range chunks (microlink-api's
  // parallel renderer) without re-navigating.
  const render = async (page, opts = {}) => {
    const {
      margin = PDF_DEFAULT_OPTS.margin,
      scale = PDF_DEFAULT_OPTS.scale,
      printBackground = PDF_DEFAULT_OPTS.printBackground,
      mediaType = PDF_DEFAULT_OPTS.mediaType,
      waitUntil,
      waitForDom,
      isPageReady,
      ...rest
    } = opts

    if (mediaType) await pReflect(page.emulateMediaType(mediaType))

    return captureWithNavigationRetry(
      () =>
        page.pdf({
          ...rest,
          margin: getMargin(margin),
          printBackground,
          scale
        }),
      { page, goto, timeout: goto.timeouts.action(rest.timeout) }
    )
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
      mediaType = PDF_DEFAULT_OPTS.mediaType,
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

    if (waitUntil !== 'auto') {
      await goto(page, { ...gotoOpts, url, waitUntil })
      await waitForDomStabilityResult(page)
      return
    }

    // Surfaced to the caller: a page whose readiness could not be confirmed
    // (`timedOut`) is a poor one to keep rendering on, so a caller reusing this
    // load across page-ranges can choose a fresh context instead.
    let readiness

    await goto(page, { ...gotoOpts, url, waitUntil, waitUntilAuto })
    return readiness

    async function waitUntilAuto (page, { timeout: autoTimeout } = {}) {
      await waitForDomStabilityResult(page)
      // Checkpoint + SPA hydrate needs more than `timeouts.action` (~2.7s): budget
      // the blank poll from the same load allowance as the readiness gate.
      const timeout = autoTimeout ?? goto.timeouts.action(rest.timeout)

      // The readiness gate waits for a page to settle — page-load work, not a
      // small action. Budgeting it from `timeouts.action` (timeout/11) gave it
      // ~1.2s while a hydrating document needs 2-3s, so it timed out on every
      // tall page and the zero-capture fast path never fired. Budget it from
      // the load allowance goto actually assigned to this phase; the gate
      // returns as soon as the page is quiet, so this is a cap, not a cost.
      const readyTime = timeSpan()
      const ready = await waitForReady(page, {
        timeout: Math.round(timeout * READY_BUDGET_RATIO)
      })
      readiness = ready
      debug('ready', { ...ready, duration: readyTime() })

      // The blank-page poll keeps its own clock, measured from here so a slow
      // gate cannot starve it. Remaining load allowance is the cap.
      const elapsed = timeSpan()
      const pollTimeout = Math.max(0, timeout - readyTime())

      // Fast path: the page settled with real painted content in a document
      // taller than the viewport — a visibly rendered image (not a tracking
      // pixel), or enough visible text with webfonts loaded (a pending
      // `font-display: block` font renders text invisible, exactly when a
      // capture would be white) — and that content is not `covered` by an
      // opaque viewport-filling layer (a fixed white loading overlay passes
      // every other DOM signal while a capture stays white): skip the
      // screenshot poll. Height and viewport come from the same in-page
      // paintSignals (`page.viewport()` is null under `defaultViewport: null`),
      // and an unknown viewport skips the fast path rather than dropping the
      // taller-than-viewport guard. A gate that timed out never settled, so
      // don't trust its partial signals: fall through to the blank check.
      let isReady =
        !ready.timedOut &&
        isPaintedContent(ready) &&
        !ready.covered &&
        ready.viewport > 0 &&
        ready.height > ready.viewport

      // Otherwise fall back to the screenshot poll — same ready check as
      // fullPage screenshot: white frame + `isPageReady` (bot-check / title).
      if (!isReady) {
        let retry = -1
        do {
          ++retry
          const screenshotTime = timeSpan()
          const screenshot = await captureWithNavigationRetry(
            () =>
              page.screenshot({
                ...rest,
                optimizeForSpeed: true,
                type: 'jpeg',
                quality: 30
              }),
            // The retry loop keeps its own clock, so hand it only what is left
            // of the shared budget — a fresh full `timeout` here would let one
            // navigation-racing capture double the worst-case prepare time.
            { page, goto, timeout: Math.max(0, pollTimeout - elapsed()) }
          )
          const isWhite = await isWhiteScreenshot(screenshot)
          const pageSnapshot = await pReflect(getPageSnapshot(page))
          const pageMeta = pageSnapshot.isRejected ? {} : pageSnapshot.value
          const pageReadyResult = await pReflect(
            isPageReady({
              page,
              screenshot,
              isWhite,
              isWhiteScreenshot,
              ...pageMeta
            })
          )
          isReady = !pageReadyResult.isRejected && !!pageReadyResult.value

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

      // PDF is inherently full-page: scroll the document (or its tallest
      // overflow scroller) so lazy sections hydrate before print, then wait
      // for the fetches that scroll triggered to go idle and the DOM to settle.
      if (isReady && elapsed() < pollTimeout) {
        const scrollTimeout = Math.max(0, pollTimeout - elapsed())
        await goto.run({
          fn: scrollFullPageToLoadContent(page, scrollTimeout),
          timeout: Math.max(scrollTimeout * 2, scrollTimeout + 1000),
          debug: 'scrollFullPageToLoadContent'
        })
        await goto.waitUntilAuto(page, {
          timeout: Math.max(0, pollTimeout - elapsed())
        })
        const settle = await waitForReady(page, {
          timeout: Math.max(0, pollTimeout - elapsed())
        })
        readiness = settle
        debug('settle', { ...settle, duration: elapsed() })
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

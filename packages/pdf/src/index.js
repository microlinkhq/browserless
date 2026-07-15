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
  resolveWaitForDom,
  SCREENSHOT_DEFAULT_OPTS
} = require('@browserless/screenshot')

const PDF_DEFAULT_OPTS = {
  waitForDom: SCREENSHOT_DEFAULT_OPTS.waitForDom,
  margin: '0.35cm',
  scale: 0.65,
  printBackground: true,
  waitUntil: 'auto'
}

// Share of the action budget the readiness gate may consume in `auto` mode. The
// remainder is reserved for the blank-SPA screenshot poll to re-wait, so the
// gate can't starve the fallback while total prepare stays within one `timeout`.
const READY_BUDGET_RATIO = 0.5

// Minimum visible characters for the text fast path. Matches the counting cap
// in `waitForReady`'s snapshot, which stops walking text nodes once reached —
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

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  // Render an already-prepared page to a PDF buffer. Split out from the load so
  // a single load can be reused across page-range chunks (microlink-api's
  // parallel renderer) without re-navigating.
  const render = (page, opts = {}) => {
    const {
      margin = PDF_DEFAULT_OPTS.margin,
      scale = PDF_DEFAULT_OPTS.scale,
      printBackground = PDF_DEFAULT_OPTS.printBackground,
      waitUntil,
      waitForDom,
      ...rest
    } = opts
    return captureWithNavigationRetry(
      () => page.pdf({ ...rest, margin: getMargin(margin), printBackground, scale }),
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
      waitUntil = PDF_DEFAULT_OPTS.waitUntil,
      waitForDom = PDF_DEFAULT_OPTS.waitForDom,
      ...rest
    } = opts
    const waitForDomOpts = resolveWaitForDom(waitForDom)

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
      await goto(page, { ...rest, url, waitUntil })
      await waitForDomStabilityResult(page)
      return
    }

    await goto(page, { ...rest, url, waitUntil, waitUntilAuto })
    async function waitUntilAuto (page) {
      await waitForDomStabilityResult(page)
      const timeout = goto.timeouts.action(rest.timeout)
      // One action budget shared by the readiness gate and the screenshot poll,
      // so worst-case prepare stays within a single `timeout` instead of one
      // per stage.
      const elapsed = timeSpan()

      // Cheap, navigation-tolerant readiness — no screenshots. Resolves once the
      // page is visually quiet (height stable, images decoded, load complete),
      // absorbing the client-side re-navigation that makes a screenshot poll
      // throw `Execution context was destroyed`. Capped at a share of the budget
      // so a slow gate still leaves the blank-SPA poll room to re-wait.
      const ready = await waitForReady(page, { timeout: Math.round(timeout * READY_BUDGET_RATIO) })
      debug('ready', { ...ready, duration: elapsed() })

      // Fast path: the page settled with real painted content in a document
      // taller than the viewport — a visibly rendered image (not a tracking
      // pixel), or enough visible text with webfonts loaded (a pending
      // `font-display: block` font renders text invisible, exactly when a
      // capture would be white) — so it can't be a blank shell: skip the
      // screenshot poll. A gate that timed out never settled, so don't trust
      // its partial snapshot: fall through to the blank check.
      const viewportHeight = (page.viewport() || {}).height || 0
      const painted = ready.painted > 0 || (ready.text >= TEXT_PAINTED_MIN && ready.fonts)
      if (!ready.timedOut && painted && ready.height > viewportHeight) return

      // Otherwise fall back to the screenshot poll — re-wait while the first
      // paint is still blank — to keep the blank-SPA protection. The page has
      // already settled, so the first capture won't race a navigation, and a
      // non-blank page exits after that single shot without an extra re-wait.
      let isWhite = false
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
          { page, goto, timeout }
        )
        isWhite = await isWhiteScreenshot(screenshot)
        if (isWhite) await goto.waitUntilAuto(page, { timeout: rest.timeout })
        debug('retry', { waitUntil, isWhite, retry, duration: screenshotTime() })
      } while (isWhite && elapsed() < timeout)

      debug({ waitUntil, isWhite, timeout, duration: require('pretty-ms')(elapsed()) })
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

'use strict'

const timeSpan = require('@kikobeats/time-span')({ format: n => Math.round(n) })
const debug = require('debug-logfmt')('browserless:pdf')
const createGoto = require('@browserless/goto')
const { setTimeout: sleep } = require('node:timers/promises')
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

// Share of the phase's load allowance the readiness gate may consume in `auto`
// mode. Pages observed settling in 0.6-3.3s (a hydrating document is the slow
// end), so a quarter of the allowance — ~3.9s at the default request budget —
// covers them with margin while keeping the cap well short of the render's
// share. The gate returns as soon as the page is quiet, so this bounds only a
// page that never settles.
const READY_BUDGET_RATIO = 0.25

// Share of the same allowance spent confirming the document carries anything at
// all before the readiness gate is asked whether it has settled.
const CONTENT_BUDGET_RATIO = 0.25

// How often to re-ask while the document is still empty.
const CONTENT_POLL = 150

// Minimum visible characters for the text fast path. Matches the counting cap
// in `waitForReady`'s snapshot, which stops walking text nodes once reached —
// raising this above the cap would make the text fast path unreachable.
const TEXT_PAINTED_MIN = 200

// Does the document carry anything at all, anywhere in it?
//
// The readiness gate is viewport-scoped by design: content below the fold is
// legitimately invisible, so `painted` and `text` reading zero is normal for a
// page whose content simply starts lower. That makes the gate unable to tell
// such a page apart from a shell that has rendered nothing yet — and a shell
// passes every other settle signal it has. Its HTML arrived, so `readyState` is
// `complete`; it has no images, so there is nothing to decode; and its height
// cannot move when the app scrolls an inner pane rather than the document, so
// height stability holds from the first poll. Observed on a report that rendered
// nothing for ~1.5s: the gate called it ready at 458ms with `painted=0 text=0`,
// and the PDF printed its skeleton placeholders.
//
// So ask a different question, document-wide rather than viewport-scoped, and
// ask it first. The element probe runs before `innerText` because it is the
// cheaper of the two and the one a rendered app trips immediately.
const hasDocumentContent = () => {
  const body = document.body
  if (!body) return false
  if (body.querySelector('img,svg,canvas,video,table,input,button,picture')) return true
  return (body.innerText || '').trim().length > 0
}

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

  // Poll until the document carries something, or the budget runs out. A page
  // that already has content answers on the first evaluate, so an ordinary
  // render pays one round trip for this.
  const waitForDocumentContent = async (page, timeout) => {
    const deadline = Date.now() + timeout
    while (true) {
      const result = await pReflect(page.evaluate(hasDocumentContent))
      // A navigation tearing down the context is not evidence either way; treat
      // it like an empty poll and try again while the budget lasts.
      if (!result.isRejected && result.value) return true
      const remaining = deadline - Date.now()
      if (remaining <= 0) return false
      await sleep(Math.min(CONTENT_POLL, remaining))
    }
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

    // Surfaced to the caller: a page whose readiness could not be confirmed
    // (`timedOut`) is a poor one to keep rendering on, so a caller reusing this
    // load across page-ranges can choose a fresh context instead.
    let readiness

    await goto(page, { ...rest, url, waitUntil, waitUntilAuto })
    return readiness

    async function waitUntilAuto (page, { timeout: autoTimeout } = {}) {
      await waitForDomStabilityResult(page)
      const timeout = goto.timeouts.action(rest.timeout)

      const contentTime = timeSpan()
      const hasContent = await waitForDocumentContent(
        page,
        Math.round((autoTimeout ?? timeout) * CONTENT_BUDGET_RATIO)
      )
      debug('content', { hasContent, duration: contentTime() })

      // The readiness gate waits for a page to settle — page-load work, not a
      // small action. Budgeting it from `timeouts.action` (timeout/11) gave it
      // ~1.2s while a hydrating document needs 2-3s, so it timed out on every
      // tall page and the zero-capture fast path never fired. Budget it from
      // the load allowance goto actually assigned to this phase; the gate
      // returns as soon as the page is quiet, so this is a cap, not a cost.
      const readyTime = timeSpan()
      const ready = await waitForReady(page, {
        timeout: Math.round((autoTimeout ?? timeout) * READY_BUDGET_RATIO)
      })
      readiness = ready
      debug('ready', { ...ready, duration: readyTime() })

      // The blank-page poll keeps its own action budget, measured from here so
      // a slow gate cannot starve it.
      const elapsed = timeSpan()

      // Fast path: the page settled with real painted content in a document
      // taller than the viewport — a visibly rendered image (not a tracking
      // pixel), or enough visible text with webfonts loaded (a pending
      // `font-display: block` font renders text invisible, exactly when a
      // capture would be white) — and that content is not `covered` by an
      // opaque viewport-filling layer (a fixed white loading overlay passes
      // every other DOM signal while a capture stays white): skip the
      // screenshot poll. Height and viewport come from the same in-page
      // snapshot (`page.viewport()` is null under `defaultViewport: null`),
      // and an unknown viewport skips the fast path rather than dropping the
      // taller-than-viewport guard. A gate that timed out never settled, so
      // don't trust its partial snapshot: fall through to the blank check.
      const painted = ready.painted > 0 || (ready.text >= TEXT_PAINTED_MIN && ready.fonts)
      if (
        !ready.timedOut &&
        painted &&
        !ready.covered &&
        ready.viewport > 0 &&
        ready.height > ready.viewport
      ) {
        return
      }

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
          // The retry loop keeps its own clock, so hand it only what is left
          // of the shared budget — a fresh full `timeout` here would let one
          // navigation-racing capture double the worst-case prepare time.
          { page, goto, timeout: Math.max(0, timeout - elapsed()) }
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

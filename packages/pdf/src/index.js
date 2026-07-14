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

      // Cheap, navigation-tolerant readiness — no screenshots. Resolves once the
      // page is visually quiet (height stable, images decoded, load complete),
      // absorbing the client-side re-navigation that makes a screenshot poll
      // throw `Execution context was destroyed`.
      const readyTime = timeSpan()
      const ready = await waitForReady(page, { timeout })
      debug('ready', { ...ready, duration: readyTime() })

      // Fast path: real painted content — decoded images in a document taller
      // than the viewport can't be a blank shell, so skip the screenshot poll.
      const viewportHeight = (page.viewport() || {}).height || 0
      if (ready.decoded > 0 && ready.height > viewportHeight) return

      // Otherwise a single white-screen check, now that the page has settled (so
      // it won't race a navigation). A genuinely blank page falls back to the
      // original screenshot poll to keep the blank-SPA protection.
      const shot = await pReflect(
        captureWithNavigationRetry(
          () => page.screenshot({ ...rest, optimizeForSpeed: true, type: 'jpeg', quality: 30 }),
          { page, goto, timeout }
        )
      )
      if (shot.isFulfilled && !(await isWhiteScreenshot(shot.value))) return

      let isWhite = true
      let retry = -1
      const timePdf = timeSpan()
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
      } while (isWhite && timePdf() < timeout)

      debug({ waitUntil, isWhite, timeout, duration: require('pretty-ms')(timePdf()) })
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

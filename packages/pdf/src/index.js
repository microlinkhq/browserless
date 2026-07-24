'use strict'

const timeSpan = require('@kikobeats/time-span')({ format: n => Math.round(n) })
const debug = require('debug-logfmt')('browserless:pdf')
const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const {
  captureWithNavigationRetry,
  isWhiteScreenshot,
  waitForReady,
  prepareFullDocument,
  expandOverflow,
  scrollFullPageToLoadContent,
  SCREENSHOT_DEFAULT_OPTS
} = require('@browserless/screenshot')

const PDF_DEFAULT_OPTS = {
  margin: '0.35cm',
  scale: 0.65,
  printBackground: true,
  waitUntil: 'auto',
  isPageReady: SCREENSHOT_DEFAULT_OPTS.isPageReady
}

const READY_BUDGET_RATIO = 0.25
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

const getPageMeta = page =>
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

  const render = async (page, opts = {}) => {
    const {
      margin = PDF_DEFAULT_OPTS.margin,
      scale = PDF_DEFAULT_OPTS.scale,
      printBackground = PDF_DEFAULT_OPTS.printBackground,
      ...rest
    } = opts

    await pReflect(page.evaluate(expandOverflow))

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

  const prepare = async (page, url, opts = {}) => {
    const {
      waitUntil = PDF_DEFAULT_OPTS.waitUntil,
      isPageReady = PDF_DEFAULT_OPTS.isPageReady,
      ...rest
    } = opts

    const checkPageReady = async (page, { response, screenshot, isWhite } = {}) => {
      const pageMetaResult = await pReflect(getPageMeta(page))
      const pageMeta = pageMetaResult.isRejected ? {} : pageMetaResult.value
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
      await goto(page, { ...rest, url, waitUntil })
      await prepareFullDocument(page, {
        goto,
        timeout: resolveScrollTimeout(goto, rest.timeout)
      })
      return
    }

    let readiness
    let isReady = false
    let didHydrateScroll = false
    let didHydrateAttempt = false

    await goto(page, { ...rest, url, waitUntil, waitUntilAuto })

    if (isReady) {
      const prep = await prepareFullDocument(page, {
        goto,
        timeout: resolveScrollTimeout(goto, rest.timeout),
        scrolled: didHydrateScroll
      })
      readiness = { ...readiness, ...prep }
    }

    return readiness

    async function waitUntilAuto (page, { response, timeout: autoTimeout } = {}) {
      const timeout = autoTimeout ?? goto.timeouts.action(rest.timeout)

      const readyTime = timeSpan()
      const ready = await waitForReady(page, {
        timeout: Math.round(timeout * READY_BUDGET_RATIO)
      })
      readiness = ready
      debug('ready', { ...ready, duration: readyTime() })

      const elapsed = timeSpan()
      const pollTimeout = Math.max(0, timeout - readyTime())

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

          const remaining = pollTimeout - elapsed()
          if (!isReady && !didHydrateAttempt && !isWhite && remaining > 1000) {
            didHydrateAttempt = true
            const hydrate = await pReflect(
              scrollFullPageToLoadContent(page, Math.min(remaining / 2, 5000))
            )
            didHydrateScroll = !hydrate.isRejected && !!hydrate.value?.hydrated
            debug('ready:hydrateScroll', {
              remaining,
              hydrated: didHydrateScroll,
              ...(hydrate.isRejected ? {} : hydrate.value)
            })
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

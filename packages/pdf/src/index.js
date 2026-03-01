'use strict'

const timeSpan = require('@kikobeats/time-span')({ format: n => Math.round(n) })
const pReflect = require('p-reflect')
const {
  isWhiteScreenshot,
  waitForDomStability,
  resolveWaitForDom,
  DEFAULT_WAIT_FOR_DOM
} = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless:pdf')
const createGoto = require('@browserless/goto')

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

  return function pdf (page) {
    return async (
      url,
      {
        margin = '0.35cm',
        scale = 0.65,
        printBackground = true,
        waitUntil = 'auto',
        waitForDom = DEFAULT_WAIT_FOR_DOM,
        ...opts
      } = {}
    ) => {
      let pdfBuffer
      const waitForDomOpts = resolveWaitForDom(waitForDom)

      const generatePdf = page =>
        page.pdf({
          ...opts,
          margin: getMargin(margin),
          printBackground,
          scale
        })

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
        await goto(page, { ...opts, url, waitUntil })
        await waitForDomStabilityResult(page)
        pdfBuffer = await generatePdf(page)
      } else {
        await goto(page, { ...opts, url, waitUntil, waitUntilAuto })
        async function waitUntilAuto (page) {
          await waitForDomStabilityResult(page)
          const timeout = goto.timeouts.action(opts.timeout)
          let isWhite = false
          let retry = -1

          const timePdf = timeSpan()

          do {
            ++retry
            const screenshotTime = timeSpan()
            const screenshot = await page.screenshot({
              ...opts,
              optimizeForSpeed: true,
              type: 'jpeg',
              quality: 30
            })
            isWhite = await isWhiteScreenshot(screenshot)
            if (retry === 1) await goto.waitUntilAuto(page, { timeout: opts.timeout })
            debug('retry', { waitUntil, isWhite, retry, duration: screenshotTime() })
          } while (isWhite && timePdf() < timeout)

          debug({ waitUntil, isWhite, timeout, duration: require('pretty-ms')(timePdf()) })
        }
        pdfBuffer = await generatePdf(page)
      }

      return pdfBuffer
    }
  }
}

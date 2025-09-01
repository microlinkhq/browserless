'use strict'

const { isWhiteScreenshot } = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless:pdf')
const createGoto = require('@browserless/goto')
const timeSpan = require('@kikobeats/time-span')({ format: n => Math.round(n) })
const { setTimeout } = require('node:timers/promises')

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
      { margin = '0.35cm', scale = 0.65, printBackground = true, waitUntil = 'auto', ...opts } = {}
    ) => {
      let pdfBuffer

      const generatePdf = page =>
        page.pdf({
          ...opts,
          margin: getMargin(margin),
          printBackground,
          scale
        })

      if (waitUntil !== 'auto') {
        await goto(page, { ...opts, url, waitUntil })
        pdfBuffer = await generatePdf(page)
      } else {
        await goto(page, { ...opts, url, waitUntil, waitUntilAuto })
        async function waitUntilAuto (page) {
          const timeout = goto.timeouts.action(goto.timeouts.base(opts.timeout))
          let isWhite = false
          let retry = -1

          const timePdf = timeSpan()

          do {
            ++retry
            const screenshotTime = timeSpan()
            isWhite = await isWhiteScreenshot(await page.screenshot(opts))
            debug('screenshot', { waitUntil, isWhite, retry, timeout, duration: screenshotTime() })
            if (retry > 0) {
              if (retry === 1) await goto.waitUntilAuto(page, { timeout: opts.timeout })
              else await setTimeout(50)
            }
          } while (isWhite && timePdf() < timeout)

          pdfBuffer = await generatePdf(page)
          debug({ waitUntil, isWhite, retry, duration: require('pretty-ms')(timePdf()) })
        }
      }

      return pdfBuffer
    }
  }
}

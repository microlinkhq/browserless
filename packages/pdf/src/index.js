'use strict'

const { takeScreenshot } = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless:pdf')
const createGoto = require('@browserless/goto')
const timeSpan = require('@kikobeats/time-span')({ format: require('pretty-ms') })

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

      const timePdf = timeSpan()

      if (waitUntil !== 'auto') {
        await goto(page, { ...opts, url, waitUntil })
        pdfBuffer = await generatePdf(page)
      } else {
        await goto(page, { ...opts, url, waitUntil, waitUntilAuto })
        async function waitUntilAuto (page) {
          const { isWhite } = await takeScreenshot({ page, goto, opts })
          pdfBuffer = await generatePdf(page)
          debug('screenshot', { waitUntil, isWhite, duration: timePdf() })
        }
      }

      return pdfBuffer
    }
  }
}

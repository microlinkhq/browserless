'use strict'

const createGoto = require('@browserless/goto')

const getMargin = unit =>
  typeof unit === 'string'
    ? {
      top: unit,
      right: unit,
      bottom: unit,
      left: unit
    }
    : unit

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return page => async (
    url,
    {
      margin = getMargin('0.25cm'),
      scale = 0.65,
      media = 'screen',
      printBackground = true,
      waitUntil = ['networkidle0'],
      ...opts
    }
  ) => {
    await goto(page, { ...opts, url, media, waitUntil })
    return page.pdf({ ...opts, margin, printBackground, scale })
  }
}

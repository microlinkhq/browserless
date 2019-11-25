'use strict'

const createGoto = require('@browserless/goto')

const getMargin = unit =>
  typeof str === 'string'
    ? {
        margin: {
          top: unit,
          right: unit,
          bottom: unit,
          left: unit
        }
      }
    : unit

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return page => async (
    url,
    {
      margin = getMargin('0.25cm'),
      media = 'screen',
      printBackground = true,
      scale = 0.65,
      waitUntil = ['networkidle0'],
      ...opts
    }
  ) => {
    await page.emulateMediaType(media)
    await goto(page, { url, waitUntil, ...opts })

    return page.pdf({
      ...opts,
      margin,
      printBackground,
      scale
    })
  }
}

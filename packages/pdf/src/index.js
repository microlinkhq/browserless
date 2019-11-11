'use strict'

const createGoto = require('@browserless/goto')

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return page => async (url, opts = {}) => {
    const {
      format = 'A4',
      margin = {
        top: '0.25cm',
        right: '0.25cm',
        bottom: '0.25cm',
        left: '0.25cm'
      },
      media = 'screen',
      printBackground = true,
      scale = 0.65,
      ...args
    } = opts

    await page.emulateMediaType(media)
    await goto(page, { url, ...args })

    return page.pdf({
      margin,
      format,
      printBackground,
      scale
    })
  }
}

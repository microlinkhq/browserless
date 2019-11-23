'use strict'

const createGoto = require('@browserless/goto')

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return page => async (
    url,
    {
      format = 'A4',
      margin = {
        top: '0.25cm',
        right: '0.25cm',
        bottom: '0.25cm',
        left: '0.25cm'
      },
      media = 'print',
      printBackground = true,
      scale = 0.65,
      ...opts
    }
  ) => {
    await page.emulateMediaType(media)
    await goto(page, { url, ...opts })

    return page.pdf({
      ...opts,
      format,
      margin,
      printBackground,
      scale
    })
  }
}

'use strict'

const goto = require('@browserless/goto')

module.exports = page => async (url, opts = {}) => {
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
    viewport,
    ...args
  } = opts

  await page.emulateMedia(media)
  await goto(page, { url, ...args })

  return page.pdf({
    margin,
    format,
    printBackground,
    scale,
    ...args
  })
}

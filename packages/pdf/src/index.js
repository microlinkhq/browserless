'use strict'

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

  return page =>
    async (url, { margin = '0.35cm', scale = 0.65, printBackground = true, ...opts } = {}) => {
      await goto(page, { ...opts, url })

      return page.pdf({
        ...opts,
        margin: getMargin(margin),
        printBackground,
        scale
      })
    }
}

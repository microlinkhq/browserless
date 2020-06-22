'use strict'

/**
 * Pass toString test, though it breaks console.debug() from working
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => {
    window.console.debug = () => null
  })

'use strict'

/**
 * Fix missing window.outerWidth/window.outerHeight in headless mode Will also set
 * the viewport to match window size, unless specified by user
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => {
    window.outerWidth = window.innerWidth
    window.outerHeight = window.innerHeight
  })

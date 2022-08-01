'use strict'

/**
 * Pass the Permissions Test.
 */
module.exports = page =>
  page.evaluateOnNewDocument(() => {
    if (window.outerWidth && window.outerHeight) return
    const windowFrame = 85 // probably OS and WM dependent
    window.outerWidth = window.innerWidth
    window.outerHeight = window.innerHeight + windowFrame
  })

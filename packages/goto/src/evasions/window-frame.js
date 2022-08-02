'use strict'

module.exports = page =>
  page.evaluateOnNewDocument(() => {
    if (window.outerWidth && window.outerHeight) return
    const windowFrame = 85
    window.outerWidth = window.innerWidth
    window.outerHeight = window.innerHeight + windowFrame
  })

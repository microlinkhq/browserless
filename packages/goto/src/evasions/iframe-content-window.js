'use strict'

module.exports = page =>
  page.evaluateOnNewDocument(() =>
    // eslint-disable-next-line
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function () {
        return window
      }
    })
  )

module.exports = page =>
  page.evaluateOnNewDocument(() =>
    Object.defineProperty(HTMLIFrameElement.prototype, 'contentWindow', {
      get: function () {
        return window
      }
    })
  )

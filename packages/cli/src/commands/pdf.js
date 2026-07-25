'use strict'

module.exports = async ({ url, browserless, opts, isPageReady }) => {
  if (typeof isPageReady === 'function') opts.isPageReady = isPageReady
  return [await browserless.pdf(url, opts)]
}

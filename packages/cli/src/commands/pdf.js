'use strict'

module.exports = async ({ url, browserless, opts }) => [await browserless.pdf(url, opts)]

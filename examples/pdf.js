'use strict'

const createBrowserless = require('..')
const browserless = createBrowserless()

require('./main')(async url => {
  const pdf = await browserless.pdf(url.toString())
  return pdf
})

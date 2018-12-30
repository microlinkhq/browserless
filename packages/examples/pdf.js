'use strict'

const createBrowserless = require('browserless')
const browserless = createBrowserless()

require('./main')(async url => {
  const pdf = await browserless.pdf(url.toString())
  return pdf
})

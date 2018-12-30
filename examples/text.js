'use strict'

const createBrowserless = require('..')
const browserless = createBrowserless()

require('./main')(async url => {
  const text = await browserless.text(url.toString())
  return text
})

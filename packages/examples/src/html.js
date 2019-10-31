'use strict'

const createBrowserless = require('browserless')
const browserless = createBrowserless()

require('./main')(async (url, opts) => {
  return {
    output: await browserless.html(url, opts)
  }
})

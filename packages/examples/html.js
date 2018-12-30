'use strict'

const createBrowserless = require('browserless')
const browserless = createBrowserless()

require('./main')(async url => {
  const html = await browserless.html(url.toString())
  return html
})

'use strict'

const createBrowserless = require('..')
const browserless = createBrowserless()

require('./main')(async url => {
  const html = await browserless.html(url.toString())
  return html
})

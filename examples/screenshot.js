'use strict'

const termImg = require('term-img')
const createBrowserless = require('..')
const browserless = createBrowserless()

require('./main')(async url => {
  const file = await browserless.screenshot(url.toString())
  termImg(file)
})

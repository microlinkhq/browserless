'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()

const url = new URL(process.argv[2])
;(async () => {
  const html = await browserless.html(url.toString())
  console.log(html)
  process.exit()
})()

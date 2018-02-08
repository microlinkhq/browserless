'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()

const url = new URL(process.argv[2])
;(async () => {
  const text = await browserless.text(url.toString())
  console.log(text)
  process.exit()
})()

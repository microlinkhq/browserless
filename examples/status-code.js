'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()

const url = new URL(process.argv[2])
;(async () => {
  const page = await browserless.page()
  page.goto(url)
  page.once('response', res => {
    console.log(res.status())
    process.exit()
  })
})()

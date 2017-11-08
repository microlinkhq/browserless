'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()

const url = new URL(process.argv[2])
;(async () => {
  const tmpStream = await browserless.pdf(url.toString(), {
    tmpOpts: {
      path: './',
      name: `${url.hostname}.${Date.now()}`
    }
  })

  const filepath = tmpStream.path
  console.log(filepath)
  process.exit()
})()

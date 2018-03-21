'use strict'

const { URL } = require('url')
const termImg = require('term-img')

const createBrowserless = require('..')
const browserless = createBrowserless()

const url = new URL(process.argv[2])
;(async () => {
  const tmpStream = await browserless.screenshot(url.toString(), {
    tmpOpts: {
      name: `${url.hostname}.${Date.now()}`
    }
  })

  try {
    termImg(tmpStream.path)
    await tmpStream.cleanup()
    process.exit()
  } catch (err) {
    console.log(`Screenshot saved at '${tmpStream.path}'`)
    process.exit()
  }
})()

'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()
const stringStream = require('string-to-stream')

const getUrlInfo = browserless.evaluate((page, response) => ({
  statusCode: response.status(),
  url: response.url(),
  redirectUrls: response.request().redirectChain()
}))

const url = new URL(process.argv[2])
;(async () => {
  const info = await getUrlInfo(url.toString())
  const stream = stringStream(JSON.stringify(info, null, 2))
  stream.pipe(process.stdout)
  stream.on('end', process.exit)
})()

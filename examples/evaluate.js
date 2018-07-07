'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()
const stringStream = require('string-to-stream')

const getUrlInfo = browserless.evaluate((page, response) => {
  const redirectChain = response.request().redirectChain()
  return {
    statusCode: response.status(),
    url: response.url(),
    redirectUrls: redirectChain.map(req => req.url()),
    redirectStatusCodes: redirectChain.map(req => req.response().status())
  }
})

const url = new URL(process.argv[2])
;(async () => {
  try {
    const info = await getUrlInfo(url.toString())
    const data = { ...info, requestUrl: url.toString() }
    const stream = stringStream(JSON.stringify(data, null, 2))
    stream.pipe(process.stdout)
    stream.on('end', process.exit)
  } catch (err) {
    console.log(err)
    process.exit(1)
  }
})()

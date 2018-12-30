'use strict'

const createBrowserless = require('browserless')
const browserless = createBrowserless()

const getUrlInfo = browserless.evaluate((page, response) => {
  const redirectChain = response.request().redirectChain()
  return {
    statusCode: response.status(),
    url: response.url(),
    redirectUrls: redirectChain.map(req => req.url()),
    redirectStatusCodes: redirectChain.map(req => req.response().status())
  }
})

require('./main')(async url => {
  const info = await getUrlInfo(url.toString())
  return { ...info, requestUrl: url.toString() }
})

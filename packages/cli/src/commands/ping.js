'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const ping = browserless.evaluate(async (page, response) => {
    const redirectChain = response.request().redirectChain()
    return {
      headers: response.headers(),
      // html: await page.content(),
      redirectStatusCodes: redirectChain.map(req => req.response().status()),
      redirectUrls: redirectChain.map(req => req.url()),
      statusCode: response.status(),
      url: response.url()
    }
  })

  const result = await ping(url, opts)

  return result
}

'use strict'

const isolatedFunction = require('isolated-function')

const createFn = code => `
async (url, browserWSEndpoint, opts) => {
  const puppeteer = require('@cloudflare/puppeteer')
  const browser = await puppeteer.connect({ browserWSEndpoint })
  const page = (await browser.pages())[1]
  try {
    return await (${code})({ page, ...opts })
  } finally {
    await browser.disconnect()
  }
}`

module.exports = async ({ url, code, vmOpts, browserWSEndpoint, ...opts }) => {
  const [fn, teardown] = isolatedFunction(createFn(code), {
    ...vmOpts,
    throwError: false
  })

  const result = await fn(url, browserWSEndpoint, opts)

  await teardown()

  return result
}

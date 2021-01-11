'use strict'

const createBrowserless = require('browserless')

module.exports = async (url, opts) => {
  const browserless = createBrowserless()
  const page = await browserless.page()
  const response = await page.goto(url, opts)
  const status = response.status()
  await browserless.close()
  return status
}

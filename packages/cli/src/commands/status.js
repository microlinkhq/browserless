'use strict'

const createBrowserless = require('browserless')
const browserless = createBrowserless()

module.exports = async (url, opts) => {
  const page = await browserless.page()
  const response = await page.goto(url, opts)
  return response.status()
}

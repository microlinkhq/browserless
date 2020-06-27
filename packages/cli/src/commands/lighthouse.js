'use strict'

const createBrowserless = require('browserless')

const lighthouse = require('../../../lighthouse/src')

module.exports = async (url, opts) => {
  const browserless = createBrowserless()
  const getBrowserless = () => browserless

  const report = await lighthouse(url, { getBrowserless, ...opts })

  await browserless.destroy()

  return report
}

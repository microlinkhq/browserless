'use strict'

const lighthouse = require('../../../lighthouse/src')

module.exports = async ({ url, browserless, opts }) => {
  const getBrowserless = () => browserless
  const report = await lighthouse(url, { getBrowserless, ...opts })
  return JSON.stringify(report, null, 2)
}

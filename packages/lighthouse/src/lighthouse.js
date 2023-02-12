'use strict'

const lighthouse = require('lighthouse/core/index.cjs')

module.exports = async ({ url, flags, config, page }) => {
  const { lhr, report } = await lighthouse(url, flags, config, page)
  return flags.output === 'json' ? lhr : report
}

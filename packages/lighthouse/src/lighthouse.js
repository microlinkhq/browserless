'use strict'

const lighthouse = require('lighthouse/core/index.cjs')

module.exports = async ({ url, config, flags, page }) => {
  const { lhr, report } = await lighthouse(url, flags, config, page)
  return config.settings.output === 'json' ? lhr : report
}

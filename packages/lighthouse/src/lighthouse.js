'use strict'

const lighthouse = require('lighthouse/core/index.cjs')

module.exports = async ({ url, config, page }) => {
  const { lhr, report } = await lighthouse(url, undefined, config, page)
  return config.settings.output === 'json' ? lhr : report
}

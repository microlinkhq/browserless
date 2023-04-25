'use strict'

const createLighthouse = require('../../../lighthouse/src')

module.exports = async ({ url, browserless, opts }) => {
  const lighthouse = createLighthouse(async teardown => {
    teardown(() => browserless.destroyContext())
    return browserless
  })

  const report = await lighthouse(url)

  return [JSON.stringify(report), JSON.stringify(report, null, 2)]
}

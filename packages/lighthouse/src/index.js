'use strict'

const lighthouse = require('./lighthouse')
const getConfig = require('./get-config')

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const getFlags = ({ disableStorageReset = true, logLevel = 'error', output = 'json' }) => ({
  disableStorageReset,
  logLevel,
  output
})

module.exports = getBrowserless => async (
  url,
  { timeout, disableStorageReset, logLevel, output, ...opts } = {}
) => {
  let teardown
  const browserless = await getBrowserless(fn => (teardown = fn))

  const fn = page => async () =>
    lighthouse({
      config: await getConfig(opts),
      flags: getFlags({ disableStorageReset, logLevel, output }),
      page,
      url
    })

  const result = await browserless.runOnPage(fn, { timeout })()
  if (teardown) await teardown()
  return result
}

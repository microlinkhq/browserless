'use strict'

const lighthouse = require('./lighthouse')
const getConfig = require('./get-config')

module.exports = getBrowserless => async (
  url,
  {
    configPath,
    hostname,
    logLevel = 'error',
    output = 'json',
    plugins,
    port,
    timeout,
    ...opts
  } = {}
) => {
  let teardown
  const browserless = await getBrowserless(fn => (teardown = fn))

  const fn = page => async () =>
    lighthouse({
      config: await getConfig(opts),
      // https://github.com/GoogleChrome/lighthouse/blob/b0321f418b01b84c837a3af61337e5a811f75552/types/externs.d.ts#L15
      flags: {
        configPath,
        hostname,
        logLevel,
        output,
        plugins,
        port
      },
      page,
      url
    })

  const result = await browserless.withPage(fn, { timeout })()
  if (teardown) await teardown()
  return result
}

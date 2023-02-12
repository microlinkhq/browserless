'use strict'

const lighthouse = require('./lighthouse')
const getConfig = require('./get-config')

module.exports = getBrowserless => async (url, { output = 'json', timeout, ...opts } = {}) => {
  let teardown
  const browserless = await getBrowserless(fn => (teardown = fn))

  const fn = page => async () =>
    lighthouse({
      config: await getConfig({ ...opts, output }),
      page,
      url
    })

  const result = await browserless.withPage(fn, { timeout })()
  if (teardown) await teardown()
  return result
}

'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const result = await browserless.text(url, opts)
  return [result]
}

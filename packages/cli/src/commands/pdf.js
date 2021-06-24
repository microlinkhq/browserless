'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const result = await browserless.pdf(url, opts)
  return result
}

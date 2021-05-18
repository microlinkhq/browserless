'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const result = await browserless.html(url, opts)
  return result
}

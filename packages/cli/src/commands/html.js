'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const html = await browserless.html(url, opts)
  return [html]
}

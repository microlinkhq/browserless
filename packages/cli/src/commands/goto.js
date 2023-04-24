'use strict'

module.exports = async ({ url, browserless, opts }) => {
  const page = await browserless.page()
  return [await browserless.goto(page, { url, ...opts })]
}

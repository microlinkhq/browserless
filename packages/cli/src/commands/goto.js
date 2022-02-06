'use strict'

const { setTimeout } = require('timers/promises')

module.exports = async ({ url, browserless, opts }) => {
  const page = await browserless.page()
  await browserless.goto(page, { url, ...opts })
  await setTimeout(8.64e7)
}

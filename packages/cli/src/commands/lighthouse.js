'use strict'

const { existsSync } = require('fs')
const { resolve } = require('path')

const lighthousePath = resolve(__dirname, '../../../lighthouse/src')

let createLighthouse

if (existsSync(lighthousePath)) {
  createLighthouse = require(lighthousePath)
} else {
  console.error('The @browserless/lighthouse package is not installed.')
  console.error('Please install it by running: npm install -g @browserless/lighthouse')
  process.exit(1)
}

module.exports = async ({ url, browserless, opts }) => {
  const lighthouse = createLighthouse(async teardown => {
    teardown(() => browserless.destroyContext())
    return browserless
  })

  const report = await lighthouse(url)

  return [JSON.stringify(report), JSON.stringify(report, null, 2)]
}

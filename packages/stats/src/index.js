'use strict'

const requireOneOf = require('require-one-of')
const { pick, mapValues } = require('lodash')
const lighthouse = require('lighthouse')

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const DEFAULT_LIGHTHOUSE_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    onlyAudits: [
      'first-contentful-paint',
      'first-meaningful-paint',
      'first-cpu-idle',
      'speed-index',
      'interactive',
      'resource-summary'
    ]
  }
}

const getWsEndpoint = async getBrowserless => {
  const browserless = await getBrowserless()
  const browser = await browserless.browser
  return browser.wsEndpoint()
}

// see https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#differences-from-cli-flags
const getOptions = async getBrowserless => ({
  port: new URL(await getWsEndpoint(getBrowserless)).port,
  output: 'json',
  logLevel: 'error'
})

const getLighthouseReport = async (
  url,
  {
    lighthouseConfig = DEFAULT_LIGHTHOUSE_CONFIG,
    getBrowserless = requireOneOf(['@browserless/pool', 'browserless'])
  } = {}
) => {
  const options = await getOptions(getBrowserless)
  const { lhr } = await lighthouse(url, options, lighthouseConfig)
  return lhr
}

module.exports = async (url, opts) => {
  const { audits } = await getLighthouseReport(url, opts)

  return mapValues(audits, audit => {
    const { id } = audit
    switch (id) {
      case 'resource-summary':
        return audit.details.items.map(item => pick(item, ['size', 'requestCount', 'resourceType']))
      default:
        return pick(audit, ['title', 'description', 'score', 'value'])
    }
  })
}

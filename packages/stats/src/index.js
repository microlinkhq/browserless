'use strict'

const lighthouse = require('lighthouse')
const { pick, mapValues } = require('lodash')

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

const getWsEndpoint = async createBrowserless => {
  const browserless = createBrowserless()
  const browser = await browserless.browser
  return browser.wsEndpoint()
}

// see https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#differences-from-cli-flags
const getOptions = async createBrowserless => ({
  port: new URL(await getWsEndpoint(createBrowserless)).port,
  output: 'json',
  logLevel: 'error'
})

const getLighthouseReport = async (
  url,
  { lighthouseConfig = DEFAULT_LIGHTHOUSE_CONFIG, createBrowserless = require('browserless') } = {}
) => {
  const options = await getOptions(createBrowserless)
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

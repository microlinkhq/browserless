'use strict'

const requireOneOf = require('require-one-of')
const { pick, mapValues } = require('lodash')
const prettyBytes = require('pretty-bytes')
const lighthouse = require('lighthouse')

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const DEFAULT_LIGHTHOUSE_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    onlyAudits: [
      // minimal
      'first-contentful-paint',
      'first-meaningful-paint',
      'first-cpu-idle',
      'speed-index',
      'interactive',
      'resource-summary',
      // extends
      'time-to-first-byte',
      'estimated-input-latency',
      'total-blocking-time',
      'max-potential-fid',
      'errors-in-console',
      'bootup-time',
      'redirects',
      'uses-rel-preload',
      'uses-rel-preconnect',
      'network-rtt',
      'network-server-latency',
      'image-alt',
      'dom-size',
      'uses-http2',
      'meta-description'
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
      case 'network-rtt':
      case 'network-server-latency':
        return {
          ...pick(audit, ['title', 'description']),
          duration: audit.numericValue,
          duration_pretty: audit.displayValue
        }
      case 'resource-summary':
        return {
          ...pick(audit, ['title', 'description']),
          ...audit.details.items.reduce(
            (acc, { requestCount: count, resourceType: type, size }) => ({
              ...acc,
              [type]: {
                count,
                size,
                size_pretty: prettyBytes(size)
              }
            }),
            {}
          )
        }
      default:
        return pick(audit, ['title', 'description', 'score'])
    }
  })
}

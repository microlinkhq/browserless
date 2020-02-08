'use strict'

const { toNumber, get, isEmpty, pickBy, pick, mapValues } = require('lodash')
const requireOneOf = require('require-one-of')
const prettyBytes = require('pretty-bytes')
const lighthouse = require('lighthouse')
const prettyMs = require('pretty-ms')

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const DEFAULT_LIGHTHOUSE_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    // emulatedFormFactor: 'mobile',
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

// see https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#differences-from-cli-flags
const getOptions = browser => ({
  port: new URL(browser.wsEndpoint()).port,
  output: 'json',
  logLevel: 'error'
})

const getLighthouseReport = async (
  url,
  {
    lighthouseConfig = DEFAULT_LIGHTHOUSE_CONFIG,
    getBrowserless = requireOneOf(['browserless'])
  } = {}
) => {
  const browserless = await getBrowserless()
  const browser = await browserless.browser
  const options = await getOptions(browser)
  const { lhr } = await lighthouse(url, options, lighthouseConfig)
  return lhr
}

const getDuration = ({ numericValue: duration }) =>
  duration ? { duration, duration_pretty: prettyMs(duration) } : undefined

const getScore = ({ score }) => (score ? { score: toNumber((score * 100).toFixed(0)) } : undefined)

const getDetails = ({ details }) =>
  !isEmpty(get(details, 'items')) ? { details: pick(details, ['heading', 'items']) } : undefined

module.exports = async (url, opts) => {
  const { audits } = await getLighthouseReport(url, opts)

  return mapValues(audits, audit => {
    const { id } = audit
    switch (id) {
      case 'resource-summary':
        return {
          ...pick(audit, ['title', 'description']),
          ...audit.details.items.reduce(
            (acc, { requestCount: count, resourceType: type, size }) => {
              return { ...acc, [type]: { count, size, size_pretty: prettyBytes(size) } }
            },
            {}
          )
        }
      default:
        return pickBy({
          ...pick(audit, ['title', 'description']),
          ...getScore(audit),
          ...getDuration(audit),
          ...getDetails(audit)
        })
    }
  })
}

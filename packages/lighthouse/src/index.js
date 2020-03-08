'use strict'

const { get, isEmpty, pickBy, mapValues } = require('lodash')
const requireOneOf = require('require-one-of')
const prettyBytes = require('pretty-bytes')
const lighthouse = require('lighthouse')
const prettyMs = require('pretty-ms')

const { getPerception, getDuration, getScore, getDetails, getInfo } = require('./normalize')

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const DEFAULT_LIGHTHOUSE_CONFIG = {
  extends: 'lighthouse:default',
  settings: {
    maxWaitForFcp: 10.5 * 1000,
    maxWaitForLoad: 24.5 * 1000,
    emulatedFormFactor: 'desktop',
    onlyAudits: [
      // minimal
      'first-contentful-paint',
      'first-meaningful-paint',
      'first-cpu-idle',
      'speed-index',
      'interactive',
      'resource-summary',
      // extends
      'screenshot-thumbnails',
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

module.exports = async (url, opts) => {
  const { audits } = await getLighthouseReport(url, opts)

  return mapValues(audits, audit => {
    const { id } = audit
    switch (id) {
      case 'resource-summary': {
        const items = get(audit, 'details.items')
        const details = isEmpty(items)
          ? undefined
          : items.reduce((acc, { requestCount: count, resourceType: type, size }) => {
              return { ...acc, [type]: { count, size, size_pretty: prettyBytes(size) } }
            }, {})

        return { ...getInfo(audit), details }
      }
      case 'screenshot-thumbnails': {
        const items = get(audit, 'details.items')
        const details = isEmpty(items)
          ? undefined
          : { items: items.map(item => ({ ...item, timing_pretty: prettyMs(item.timing) })) }
        return { ...getInfo(audit), details }
      }
      case 'network-server-latency': {
        const items = get(audit, 'details.items')
        const details = isEmpty(items)
          ? undefined
          : {
              items: items.map(({ origin, serverResponseTime: duration }) => ({
                origin,
                duration,
                duration_pretty: prettyMs(duration)
              }))
            }
        return { ...getInfo(audit), ...getDuration(audit), details }
      }
      case 'network-rtt': {
        const items = get(audit, 'details.items')
        const details = isEmpty(items)
          ? undefined
          : {
              items: items.map(({ origin, rtt: duration }) => ({
                origin,
                duration,
                duration_pretty: prettyMs(duration)
              }))
            }
        return { ...getInfo(audit), ...getDuration(audit), details }
      }
      case 'bootup-time': {
        const items = get(audit, 'details.items')
        const details = isEmpty(items)
          ? undefined
          : {
              items: items.map(
                ({ url, total: duration, scripting: script, scriptParseCompile: parse }) => ({
                  url: url.toLowerCase(),
                  duration,
                  duration_pretty: prettyMs(duration),
                  script,
                  script_pretty: prettyMs(script),
                  parse,
                  parse_pretty: prettyMs(parse)
                })
              )
            }
        return { ...getInfo(audit), ...getScore(audit), ...getDuration(audit), details }
      }
      case 'uses-rel-preconnect': {
        const items = get(audit, 'details.items')
        const details = isEmpty(items)
          ? undefined
          : {
              items: items.map(({ url: origin, wastedMs: duration }) => ({
                origin,
                duration,
                duration_pretty: prettyMs(duration)
              }))
            }
        return { ...getInfo(audit), ...getScore(audit), ...getDuration(audit), details }
      }
      default:
        return pickBy({
          ...getInfo(audit),
          ...getPerception(audit),
          ...getScore(audit),
          ...getDuration(audit),
          ...getDetails(audit)
        })
    }
  })
}

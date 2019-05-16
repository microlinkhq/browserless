'use strict'

const { FiltersEngine, makeRequest } = require('@cliqz/adblocker')
const { getDevice } = require('@browserless/devices')
const debug = require('debug')('browserless:goto')
const tldts = require('tldts')
const path = require('path')
const fs = require('fs')

const engine = FiltersEngine.parse(fs.readFileSync(path.resolve(__dirname, './rules.txt'), 'utf-8'))

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const types = {
  document: 'main_frame',
  eventsource: 'other',
  fetch: 'xhr',
  font: 'font',
  image: 'image',
  manifest: 'other',
  media: 'media',
  other: 'other',
  script: 'script',
  stylesheet: 'stylesheet',
  texttrack: 'other',
  websocket: 'websocket',
  xhr: 'xhr'
}

/**
 *
 * Mapping from puppeteer request types to adblocker. This is needed because not all
 * types from puppeteer have the same name as the webRequest APIs from browsers
 * (which the adblocker expects).
 *
 * Related:
 * - https://github.com/GoogleChrome/puppeteer/blob/v1.14.0/docs/api.md#requestresourcetype
 * - https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/ResourceType
 */
const webRequestType = resourceType => {
  const type = types[resourceType]
  if (!type) throw Error(`Type ${resourceType} not mapped`)
  return type
}

const WAIT_UNTIL = ['networkidle0']

module.exports = async (
  page,
  {
    url,
    device,
    adblock,
    headers,
    abortTypes = [],
    cookies = [],
    waitFor = 0,
    waitUntil = WAIT_UNTIL,
    userAgent: fallbackUserAgent,
    viewport: fallbackViewport,
    ...args
  }
) => {
  await page.setRequestInterception(true)
  let reqCount = { abort: 0, continue: 0 }

  page.on('request', req => {
    const resourceUrl = req.url()
    const resourceType = req.resourceType()

    if (abortTypes.includes(resourceType)) {
      debug(`abort:${resourceType}:${++reqCount.abort}`, resourceUrl)
      return req.abort()
    }

    if (adblock) {
      const { match: isMatch } = engine.match(
        makeRequest(
          {
            type: webRequestType(resourceType),
            sourceUrl: req.frame().url(),
            url: resourceUrl
          },
          url => tldts.parse(url)
        )
      )

      if (isMatch) {
        debug(`abort:tracker:${++reqCount.abort}`, resourceUrl)
        return req.abort()
      }
    }

    debug(`continue:${resourceType}:${++reqCount.continue}`, resourceUrl)
    return req.continue()
  })

  if (headers) {
    debug('set headers', headers)
    await page.setExtraHTTPHeaders(headers)
  }

  if (cookies.length) {
    debug('set cookies', cookies)
    await page.setCookie(...cookies)
  }

  const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(device) || {}
  const userAgent = deviceUserAgent || fallbackUserAgent

  if (userAgent) {
    debug('set userAgent', userAgent)
    await page.setUserAgent(userAgent)
  }

  const viewport = { ...deviceViewport, ...fallbackViewport }
  if (!isEmpty(viewport)) {
    debug('set viewport', viewport)
    await page.setViewport(viewport)
  }

  const response = await page.goto(url, { waitUntil, ...args })

  if (waitFor) {
    debug('waitFor', waitFor)
    await page.waitFor(waitFor)
  }

  debug(reqCount)
  return response
}

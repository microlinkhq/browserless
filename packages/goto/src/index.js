'use strict'

const { getDevice } = require('@browserless/devices')
const debug = require('debug')('browserless:goto')
const extractDomain = require('extract-domain')

const isTracker = require('./is-tracker')

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const isExternalUrl = (domainOne, domainTwo) => domainOne !== domainTwo

const WAIT_UNTIL = ['networkidle0']

module.exports = async (
  page,
  {
    url,
    device,
    abortTrackers,
    abortTypes = [],
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

    const urlDomain = extractDomain(url)
    const resourceDomain = extractDomain(resourceUrl)
    const isExternal = isExternalUrl(urlDomain, resourceDomain)

    if (abortTrackers && isExternal && isTracker(resourceDomain)) {
      debug(`abort:tracker:${++reqCount.abort}`, resourceUrl)
      return req.abort()
    }
    debug(`continue:${resourceType}:${++reqCount.continue}`, resourceUrl)
    return req.continue()
  })

  const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(device) || {}

  const userAgent = deviceUserAgent || fallbackUserAgent
  if (userAgent) await page.setUserAgent(userAgent)
  const viewport = { ...deviceViewport, ...fallbackViewport }
  if (!isEmpty(viewport)) await page.setViewport(viewport)
  const response = await page.goto(url, { waitUntil, ...args })
  if (waitFor) await page.waitFor(waitFor)
  debug(reqCount)
  return response
}

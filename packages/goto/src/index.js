'use strict'

const debug = require('debug-logfmt')('browserless:goto')
const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const { getDevice } = require('@browserless/devices')
const path = require('path')
const fs = require('fs')

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const WAIT_UNTIL = ['networkidle0']

module.exports = async (
  page,
  {
    url,
    device,
    adblock = true,
    headers,
    cookies = [],
    waitFor = 0,
    waitUntil = WAIT_UNTIL,
    userAgent: fallbackUserAgent,
    viewport: fallbackViewport,
    ...args
  }
) => {
  if (adblock) {
    debug('enable adblocker')
    await engine.enableBlockingInPage(page)

    engine.on('request-blocked', ({ url }) => {
      debug('request blocked', url)
    })

    engine.on('request-redirected', ({ url }) => {
      debug('request redirected', url)
    })
  }

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

  return response
}

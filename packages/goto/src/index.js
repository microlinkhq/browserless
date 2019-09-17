'use strict'

const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const debug = require('debug-logfmt')('browserless:goto')
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
    headers = {},
    cookies = [],
    waitFor = 0,
    waitUntil = WAIT_UNTIL,
    userAgent: _userAgent,
    viewport: fallbackViewport,
    ...args
  }
) => {
  if (adblock) {
    await engine.enableBlockingInPage(page)
    engine.on('request-blocked', ({ url }) => debug('adblock:block', url))
    engine.on('request-redirected', ({ url }) => debug('adblock:redirect', url))
  }

  if (Object.keys(headers).length !== 0) {
    debug({ headers })
    await page.setExtraHTTPHeaders(headers)
  }

  if (cookies.length) {
    debug({ cookies })
    await page.setCookie(...cookies)
  }

  const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(device) || {}

  const userAgent = _userAgent || headers['user-agent'] || deviceUserAgent

  if (userAgent) {
    debug({ userAgent })
    await page.setUserAgent(userAgent)
  }

  const viewport = { ...deviceViewport, ...fallbackViewport }
  if (!isEmpty(viewport)) {
    debug('viewport', viewport)
    await page.setViewport(viewport)
  }

  const response = await page.goto(url, { waitUntil, ...args })

  if (waitFor) {
    debug({ waitFor })
    await page.waitFor(waitFor)
  }

  return response
}

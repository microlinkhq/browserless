'use strict'

const { PuppeteerBlocker } = require('@cliqz/adblocker-puppeteer')
const debug = require('debug-logfmt')('browserless:goto')
const createDevices = require('@browserless/devices')
const { getDomain } = require('tldts')
const path = require('path')
const fs = require('fs')

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const WAIT_UNTIL = ['networkidle0']

const parseCookies = (url, str) => {
  const domain = `.${getDomain(url)}`
  return str.split(';').reduce((acc, str) => {
    const [name, value] = str.split('=')
    const cookie = {
      name: name.trim(),
      value,
      domain,
      url,
      path: '/'
    }
    return [...acc, cookie]
  }, [])
}

module.exports = (
  puppeteerDevices = require('require-one-of')([
    'puppeteer-core/DeviceDescriptors',
    'puppeteer/DeviceDescriptors',
    'puppeteer-firefox/DeviceDescriptors'
  ])
) => {
  const { devices, getDevice } = createDevices(puppeteerDevices)

  const goto = async (
    page,
    {
      url,
      device,
      adblock = true,
      headers = {},
      waitFor = 0,
      waitUntil = WAIT_UNTIL,
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
      debug('headers', headers)
      await page.setExtraHTTPHeaders(headers)
    }

    if (typeof headers.cookie === 'string') {
      const cookies = parseCookies(url, headers.cookie)
      debug('cookies', ...cookies)
      await page.setCookie(...cookies)
    }

    const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(device) || {}

    const userAgent = headers['user-agent'] || deviceUserAgent

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

  goto.devices = devices
  return goto
}

module.exports.parseCookies = parseCookies

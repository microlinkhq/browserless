'use strict'

const extractDomain = require('extract-domain')
const debug = require('debug')('browserless')
const puppeteer = require('puppeteer')
const tempy = require('tempy')

const { getDevice } = require('./devices')
const isTracker = require('./is-tracker')

const { promisify } = require('util')
const fs = require('fs')

const unlink = promisify(fs.unlink)
const unlinkSync = promisify(fs.unlinkSync)

const WAIT_UNTIL = ['networkidle2', 'load', 'domcontentloaded']

const EVALUATE_TEXT = page => page.evaluate(() => document.body.innerText)

const EVALUATE_HTML = page => page.content()

const isExternalUrl = (domainOne, domainTwo) => domainOne !== domainTwo

const createTempFile = opts => {
  const tmp = tempy.file(opts)
  return {
    path: tmp,
    cleanup: unlink.bind(unlink, tmp),
    cleanupSync: unlinkSync.bind(unlinkSync, tmp)
  }
}

// The puppeteer launch causes many events to be emitted.
process.setMaxListeners(0)

module.exports = ({
  incognito = true,
  timeout = 30000,
  ...launchOpts
} = {}) => {
  let browser = puppeteer.launch({
    ignoreHTTPSErrors: true,
    args: [
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-offer-upload-credit-cards',
      '--disable-setuid-sandbox',
      '--enable-async-dns',
      '--enable-simple-cache-backend',
      '--enable-tcp-fast-open',
      '--media-cache-size=33554432',
      '--no-default-browser-check',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--prerender-from-omnibox=disabled'
    ],
    ...launchOpts
  })

  const newPage = () =>
    Promise.resolve(browser).then(async browser => {
      const context = incognito
        ? await browser.createIncognitoBrowserContext()
        : browser
      const page = await context.newPage()
      page.setDefaultNavigationTimeout(timeout)
      return page
    })

  const goto = async (
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

    const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(
      device
    )

    const userAgent = deviceUserAgent || fallbackUserAgent
    if (userAgent) await page.setUserAgent(userAgent)
    const viewport = { ...deviceViewport, ...fallbackViewport }
    if (viewport) await page.setViewport(viewport)
    const response = await page.goto(url, { waitUntil, ...args })
    if (waitFor) await page.waitFor(waitFor)
    debug(reqCount)
    return response
  }

  const evaluate = fn => async (url, opts = {}) => {
    const {
      abortTrackers = true,
      abortTypes = ['image', 'media', 'stylesheet', 'font'],
      ...args
    } = opts

    const page = await newPage()
    const response = await goto(page, {
      url,
      abortTrackers,
      abortTypes,
      ...args
    })
    const content = await fn(page, response)
    await page.close()
    return content
  }

  const screenshot = async (url, opts = {}) => {
    const {
      device = 'macbook pro 13',
      tmpOpts,
      type = 'png',
      viewport,
      ...args
    } = opts

    const tempFile = createTempFile({ extension: type, ...tmpOpts })
    const page = await newPage()
    await goto(page, { url, device, ...args })
    await page.screenshot({ path: tempFile.path, type, ...args })
    await page.close()
    return tempFile
  }

  const pdf = async (url, opts = {}) => {
    const {
      format = 'A4',
      margin = {
        top: '0.25cm',
        right: '0.25cm',
        bottom: '0.25cm',
        left: '0.25cm'
      },
      media = 'screen',
      printBackground = true,
      scale = 0.65,
      tmpOpts,
      viewport,
      ...args
    } = opts

    const tempFile = createTempFile({ extension: 'pdf', ...tmpOpts })
    const page = await newPage()
    await page.emulateMedia(media)
    await goto(page, { url, ...args })
    await page.pdf({
      path: tempFile.path,
      margin,
      format,
      printBackground,
      scale,
      ...args
    })
    await page.close()
    return tempFile
  }

  return {
    browser,
    html: evaluate(EVALUATE_HTML),
    text: evaluate(EVALUATE_TEXT),
    evaluate,
    pdf,
    screenshot,
    page: newPage,
    goto
  }
}

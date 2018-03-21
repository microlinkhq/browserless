'use strict'

const createTempFile = require('create-temp-file2')
const extractDomain = require('extract-domain')
const puppeteer = require('puppeteer')
const debug = require('debug')('browserless')

const { devices, getDevice } = require('./devices')
const isTracker = require('./is-tracker')

const WAIT_UNTIL = ['networkidle2', 'load', 'domcontentloaded']

const EVALUATE_TEXT = page => page.evaluate(() => document.body.innerText)

const EVALUATE_HTML = page => page.content()

const isEmpty = val => val == null || !(Object.keys(val) || val).length

const isExternalUrl = (domainOne, domainTwo) => domainOne !== domainTwo

module.exports = launchOpts => {
  let browser = puppeteer.launch(launchOpts)

  const newPage = () =>
    Promise.resolve(browser).then(browser => browser.newPage())

  const goto = async (page, { url, abortTypes, waitFor, waitUntil, args }) => {
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

      if (isExternal && isTracker(resourceDomain)) {
        debug(`abort:tracker:${++reqCount.abort}`, resourceUrl)
        return req.abort()
      }

      debug(`continue:${resourceType}:${++reqCount.continue}`, resourceUrl)
      return req.continue()
    })

    await page.goto(url, Object.assign({ waitUntil }, args))
    if (waitFor) await page.waitFor(waitFor)
    debug(reqCount)
  }

  const createGetContent = evaluate => async (url, opts = {}) => {
    const {
      abortTypes = ['image', 'media', 'stylesheet', 'font', 'xhr'],
      waitFor = 0,
      waitUntil = WAIT_UNTIL,
      ...args
    } = opts

    const page = await newPage()
    await goto(page, { url, abortTypes, waitFor, waitUntil, args })
    const content = await evaluate(page)

    await page.close()
    return content
  }

  const screenshot = async (url, opts = {}) => {
    const {
      abortTypes = [],
      device: deviceName = 'macbook pro 13',
      tmpOpts,
      type = 'png',
      userAgent,
      viewport,
      waitFor = 0,
      waitUntil = WAIT_UNTIL,
      ...args
    } = opts

    const tempFile = createTempFile(Object.assign({ ext: `.${type}` }, tmpOpts))
    const { path } = tempFile

    const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(
      deviceName
    )

    const page = await newPage()

    await page.setUserAgent(isEmpty(userAgent) ? deviceUserAgent : userAgent)
    await page.setViewport(Object.assign({}, deviceViewport, viewport))
    await goto(page, { url, abortTypes, waitFor, waitUntil, args })
    await page.screenshot(Object.assign({ path, type }, args))

    await page.close()
    return Promise.resolve(tempFile)
  }

  const pdf = async (url, opts = {}) => {
    const {
      abortTypes = [],
      device: deviceName = 'macbook pro 13',
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
      userAgent,
      viewport,
      waitFor = 0,
      waitUntil = WAIT_UNTIL,
      ...args
    } = opts

    const tempFile = createTempFile(Object.assign({ ext: `.pdf` }, tmpOpts))
    const { path } = tempFile
    const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(
      deviceName
    )

    const page = await newPage()

    await page.emulateMedia(media)
    await page.setUserAgent(isEmpty(userAgent) ? deviceUserAgent : userAgent)
    await page.setViewport(Object.assign({}, deviceViewport, viewport))
    await goto(page, { url, abortTypes, waitFor, waitUntil, args })
    await page.pdf(
      Object.assign(
        {
          margin,
          path,
          format,
          printBackground,
          scale
        },
        args
      )
    )

    await page.close()
    return Promise.resolve(tempFile)
  }

  return {
    html: createGetContent(EVALUATE_HTML),
    text: createGetContent(EVALUATE_TEXT),
    pdf,
    screenshot,
    page: newPage,
    goto
  }
}

module.exports.devices = devices

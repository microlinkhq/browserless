'use strict'

const createTempFile = require('create-temp-file2')
const isEmpty = require('lodash.isempty')
const puppeteer = require('puppeteer')

const debugHtml = require('debug')('browserless:html')

const { devices, getDevice } = require('./devices')

const WAIT_UNTIL = ['networkidle2', 'load', 'domcontentloaded']

module.exports = launchOpts => {
  let browser = puppeteer.launch(launchOpts)

  const newPage = () =>
    Promise.resolve(browser).then(browser => browser.newPage())

  const goto = async (page, { url, abortTypes, waitFor, waitUntil, args }) => {
    await page.setRequestInterception(true)

    page.on('request', req => {
      const resourceType = req.resourceType()
      const action = abortTypes.includes(resourceType) ? 'abort' : 'continue'

      debugHtml(action, resourceType, req.url())
      return req[action]()
    })

    await page.goto(url, Object.assign({ waitUntil }, args))
    if (waitFor) await page.waitFor(waitFor)
  }

  const text = async (url, opts = {}) => {
    const {
      abortTypes = ['image', 'media', 'stylesheet', 'font', 'xhr'],
      waitFor = 0,
      waitUntil = WAIT_UNTIL,
      ...args
    } = opts

    const page = await newPage()
    await goto(page, { url, abortTypes, waitFor, waitUntil, args })
    const text = await page.evaluate(() => document.body.innerText)

    await page.close()
    return text
  }

  const html = async (url, opts = {}) => {
    const {
      abortTypes = ['image', 'media', 'stylesheet', 'font', 'xhr'],
      waitFor = 0,
      waitUntil = WAIT_UNTIL,
      ...args
    } = opts

    const page = await newPage()
    await goto(page, { url, abortTypes, waitFor, waitUntil, args })
    const content = await page.content()

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
    html,
    text,
    pdf,
    screenshot,
    page: newPage,
    goto
  }
}

module.exports.devices = devices

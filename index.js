'use strict'

const createTempFile = require('create-temp-file2')
const isEmpty = require('lodash.isempty')
const puppeteer = require('puppeteer')

const { devices, getDevice } = require('./devices')

module.exports = launchOpts => {
  let browser = puppeteer.launch(launchOpts)

  const newPage = () =>
    Promise.resolve(browser).then(browser => browser.newPage())

  const text = async (url, opts = {}) => {
    const page = await newPage()

    await page.goto(url, opts)
    const text = page.plainText()

    page.close()
    return text
  }

  const html = async (url, opts = {}) => {
    const page = await newPage()

    await page.goto(url, opts)
    const content = await page.content()

    page.close()
    return content
  }

  const screenshot = async (url, opts = {}) => {
    const {
      tmpOpts,
      type = 'png',
      device: deviceName = 'macbook pro 13',
      userAgent,
      viewport
    } = opts

    const tempFile = createTempFile(Object.assign({ ext: `.${type}` }, tmpOpts))
    const { path } = tempFile
    const { userAgent: deviceUserAgent, viewport: deviceViewport } = getDevice(
      deviceName
    )

    const page = await newPage()

    await page.setUserAgent(isEmpty(userAgent) ? deviceUserAgent : userAgent)
    await page.setViewport(Object.assign({}, deviceViewport, viewport))
    await page.goto(url)
    await page.screenshot(Object.assign({ path, type }, opts))

    page.close()
    return Promise.resolve(tempFile)
  }

  const pdf = async (url, opts = {}) => {
    const {
      tmpOpts,
      media = 'screen',
      format = 'A4',
      printBackground = true,
      waitUntil = 'networkidle',
      scale = 0.65,
      device: deviceName = 'macbook pro 13',
      viewport,
      userAgent,
      margin = {
        top: '0.25cm',
        right: '0.25cm',
        bottom: '0.25cm',
        left: '0.25cm'
      }
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
    await page.goto(url, { waitUntil })
    await page.pdf(
      Object.assign(
        {
          margin,
          path,
          format,
          printBackground,
          scale
        },
        opts
      )
    )

    page.close()
    return Promise.resolve(tempFile)
  }

  return {
    html,
    text,
    pdf,
    screenshot
  }
}

module.exports.devices = devices

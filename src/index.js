'use strict'

const createTempFile = require('create-temp-file2')
const isEmpty = require('lodash.isempty')

const { devices, getDevice } = require('./devices')
const createPool = require('./create-pool')

module.exports = ({ poolOpts, ...launchOpts } = {}) => {
  const pool = createPool({ poolOpts, launchOpts })

  const text = (url, opts = {}) =>
    pool.use(async browser => {
      const page = await browser.newPage()

      await page.goto(url, opts)
      const text = page.plainText()

      page.close()
      return text
    })

  const html = (url, opts = {}) =>
    pool.use(async browser => {
      const page = await browser.newPage()

      await page.goto(url, opts)
      const content = await page.content()

      page.close()
      return content
    })

  const screenshot = (url, opts = {}) =>
    pool.use(async browser => {
      const {
        tmpOpts,
        type = 'png',
        device: deviceName = 'macbook pro 13',
        userAgent,
        viewport
      } = opts

      const tempFile = createTempFile(
        Object.assign({ ext: `.${type}` }, tmpOpts)
      )
      const { path } = tempFile
      const {
        userAgent: deviceUserAgent,
        viewport: deviceViewport
      } = getDevice(deviceName)

      const page = await browser.newPage()

      await page.setUserAgent(isEmpty(userAgent) ? deviceUserAgent : userAgent)
      await page.setViewport(Object.assign({}, deviceViewport, viewport))
      await page.goto(url)
      await page.screenshot(Object.assign({ path, type }, opts))

      page.close()
      return Promise.resolve(tempFile)
    })

  const pdf = (url, opts = {}) =>
    pool.use(async browser => {
      const {
        tmpOpts,
        media = 'screen',
        format = 'A4',
        printBackground = true,
        waitUntil = 'networkidle2',
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
      const {
        userAgent: deviceUserAgent,
        viewport: deviceViewport
      } = getDevice(deviceName)

      const page = await browser.newPage()

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
    })

  return {
    html,
    text,
    pdf,
    screenshot
  }
}

module.exports.devices = devices

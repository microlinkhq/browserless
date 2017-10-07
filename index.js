'use strict'

const devices = require('puppeteer/DeviceDescriptors')
const createTempFile = require('create-temp-file2')
const puppeteer = require('puppeteer')

module.exports = launchOpts => {
  let browser

  const getBrowser = async () => {
    if (browser) return browser
    browser = await puppeteer.launch(launchOpts)
    return browser
  }

  const newPage = async (url, opts) => {
    const browser = await getBrowser()
    const page = await browser.newPage()
    return page
  }

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
    const { tmpOpts, type = 'png', device: deviceDescriptor, viewport } = opts
    const tempFile = createTempFile(Object.assign({ ext: `.${type}` }, tmpOpts))
    const { path } = tempFile

    const page = await newPage()

    if (viewport) page.setViewport(viewport)

    if (deviceDescriptor) {
      const device = devices[deviceDescriptor]
      if (device) await page.emulate(device)
    }

    await page.goto(url)
    await page.screenshot(Object.assign({ path, type }, opts))
    page.close()

    return Promise.resolve(tempFile)
  }

  const pdf = async (url, opts = {}) => {
    const tempFile = createTempFile({ ext: `.pdf` })
    const { path } = tempFile

    const {
      media = 'screen',
      format = 'A4',
      printBackground = true,
      waitUntil = 'networkidle',
      viewport = {
        width: 2560,
        height: 1440
      },
      margin = {
        top: '0.25cm',
        right: '0.25cm',
        bottom: '0.25cm',
        left: '0.25cm'
      }
    } = opts

    const page = await newPage()
    await page.setViewport(viewport)
    await page.goto(url, { waitUntil })
    await page.emulateMedia(media)

    await page.pdf(
      Object.assign(
        {
          margin,
          path,
          format,
          printBackground
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

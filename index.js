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
    const { media = 'screen' } = opts
    const { path } = tempFile

    const page = await newPage()
    await page.goto(url, { waitUntil: 'networkidle' })
    await page.emulateMedia(media)
    await page.pdf(Object.assign({ path }, opts))
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

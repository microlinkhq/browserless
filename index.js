'use strict'

const devices = require('puppeteer/DeviceDescriptors')
const createTempFile = require('create-temp-file2')
const puppeteer = require('puppeteer')

module.exports = launchOpts => {
  async function text (url, opts = {}) {
    const browser = await puppeteer.launch(launchOpts)
    const page = await browser.newPage()
    await page.goto(url, opts)
    const text = page.plainText()
    browser.close()

    return text
  }

  async function html (url, opts = {}) {
    const browser = await puppeteer.launch(launchOpts)
    const page = await browser.newPage()
    await page.goto(url, opts)
    const content = await page.content()
    browser.close()

    return content
  }

  async function screenshot (url, opts = {}) {
    const { tmpOpts, type = 'png', device: deviceDescriptor, viewport } = opts
    const tempFile = createTempFile(Object.assign({ ext: `.${type}` }, tmpOpts))
    const { path } = tempFile

    const browser = await puppeteer.launch(launchOpts)
    const page = await browser.newPage()

    if (viewport) page.setViewport(viewport)

    if (deviceDescriptor) {
      const device = devices[deviceDescriptor]
      if (device) await page.emulate(device)
    }

    await page.goto(url)
    await page.screenshot(Object.assign({ path, type }, opts))
    browser.close()

    return Promise.resolve(tempFile)
  }

  async function pdf (url, opts = {}) {
    const tempFile = createTempFile({ ext: `.pdf` })
    const { media = 'screen' } = opts
    const { path } = tempFile

    const browser = await puppeteer.launch(launchOpts)
    const page = await browser.newPage()

    await page.goto(url, { waitUntil: 'networkidle' })
    await page.emulateMedia(media)
    await page.pdf(Object.assign({ path }, opts))
    browser.close()

    return Promise.resolve(tempFile)
  }

  return {
    html,
    text,
    pdf,
    screenshot
  }
}

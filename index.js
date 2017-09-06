'use strict'

const devices = require('puppeteer/DeviceDescriptors')
const createTempFile = require('create-temp-file2')
const puppeteer = require('puppeteer')

async function text (url, opts = {}) {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto(url, opts)
  const text = page.plainText()
  browser.close()
  return text
}

async function html (url, opts = {}) {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto(url, opts)
  const content = await page.content()
  browser.close()
  return content
}

async function screenshot (url, opts = {}) {
  const { tmpOpts, type = 'png', device: deviceDescriptor } = opts
  const tempFile = createTempFile(Object.assign({ ext: `.${type}` }, tmpOpts))
  const { path } = tempFile

  const browser = await puppeteer.launch()
  const page = await browser.newPage()

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

  const browser = await puppeteer.launch()
  const page = await browser.newPage()

  await page.goto(url, { waitUntil: 'networkidle' })
  await page.emulateMedia(media)
  await page.pdf(Object.assign({ path }, opts))

  return Promise.resolve(tempFile)
}

module.exports = {
  html,
  text,
  pdf,
  screenshot
}

'use strict'

const devices = require('puppeteer/DeviceDescriptors')
const createTempFile = require('create-temp-file2')
const puppeteer = require('puppeteer')

async function getHTML (url, opts = {}) {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  await page.goto(url, opts)
  const bodyHTML = await page.evaluate(() => document.documentElement.innerHTML)
  browser.close()
  return bodyHTML
}

async function takeScreenshot (url, opts = {}) {
  const { type = 'png', device: deviceDescriptor } = opts
  const tempFile = createTempFile({ ext: `.${type}` })
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

module.exports = {
  getHTML,
  takeScreenshot
}

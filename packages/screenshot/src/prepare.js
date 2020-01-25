'use strict'

const createGoto = require('@browserless/goto')
const pReflect = require('p-reflect')

const getBoundingClientRect = element => {
  const { top, left, height, width, x, y } = element.getBoundingClientRect()
  return { top, left, height, width, x, y }
}

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return async (page, url, opts = {}) => {
    const { device: deviceId = 'macbook pro 13', overlay, element, fullPage, ...args } = opts

    if (overlay.browser) {
      const value = overlay.browser.toString().includes('dark') ? 'dark' : 'light'
      await pReflect(page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value }]))
    }

    page.on('dialog', async dialog => {
      await dialog.dismiss()
    })

    const { device } = await goto(page, { url, device: deviceId, ...args })

    const screenshotOptions = {}

    if (element) {
      await page.waitForSelector(element, { visible: true })
      screenshotOptions.clip = await page.$eval(element, getBoundingClientRect)
      screenshotOptions.fullPage = false
    }

    return { device, ...screenshotOptions }
  }
}

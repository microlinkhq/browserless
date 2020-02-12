'use strict'

const createGoto = require('@browserless/goto')

const getBoundingClientRect = element => {
  const { top, left, height, width, x, y } = element.getBoundingClientRect()
  return { top, left, height, width, x, y }
}

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return async (page, url, { device = 'macbook pro 13', element, ...opts } = {}) => {
    page.on('dialog', async dialog => {
      await dialog.dismiss()
    })

    const { response } = await goto(page, { url, device, ...opts })

    const screenshotOptions = {}

    if (element) {
      await page.waitForSelector(element, { visible: true })
      screenshotOptions.clip = await page.$eval(element, getBoundingClientRect)
      screenshotOptions.fullPage = false
    }

    return [screenshotOptions, response]
  }
}

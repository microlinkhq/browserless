'use strict'

const { extension } = require('mime-types')

const createGoto = require('./goto')
const overlay = require('./overlay')
const pretty = require('./pretty')

const isJSON = headers => extension(headers['content-type']) === 'json'

module.exports = gotoOpts => {
  const goto = createGoto(gotoOpts)

  return page => async (
    url,
    { codeScheme = 'dracula', overlay: overlayOpts = {}, ...opts } = {}
  ) => {
    const [screenshotOpts, response] = await goto(page, url, opts)

    if (isJSON(response.headers()) && codeScheme) {
      await pretty(page, response, { codeScheme, ...opts })
    }

    const screenshot = await page.screenshot({
      ...opts,
      ...screenshotOpts
    })

    return Object.keys(overlayOpts).length === 0
      ? screenshot
      : overlay(screenshot, { ...opts, ...overlayOpts })
  }
}

'use strict'

const createBrowserless = require('browserless')
const exitHook = require('exit-hook')

let _browserless

const initBrowserless = opts => {
  const browserless = createBrowserless(opts)
  exitHook(browserless.close)
  return browserless
}

const getBrowserless = () => _browserless || (_browserless = initBrowserless())

const getBrowser = () => getBrowserless().browser()

const getBrowserWSEndpoint = () => getBrowser().then(browser => browser.wsEndpoint())

const getBrowserContext = () => getBrowserless().createContext()

module.exports = {
  initBrowserless,
  getBrowserless,
  getBrowserWSEndpoint,
  getBrowser,
  getBrowserContext
}

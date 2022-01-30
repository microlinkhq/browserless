'use strict'

const createBrowserless = require('browserless')
const exitHook = require('exit-hook')

let _browserless

const initBrowserless = () => {
  const browserless = createBrowserless()
  exitHook(browserless.close)
  return browserless
}

const getBrowserless = () => _browserless || (_browserless = initBrowserless())

const getBrowser = () => getBrowserless().browser()

const getBrowserWSEndpoint = () => getBrowser().then(browser => browser.wsEndpoint())

const getBrowserContext = () => getBrowserless().createContext()

module.exports = { getBrowserless, getBrowserWSEndpoint, getBrowser, getBrowserContext }

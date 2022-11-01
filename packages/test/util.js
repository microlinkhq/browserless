'use strict'

const createBrowser = require('browserless')
const exitHook = require('exit-hook')

let _browser

const initBrowser = opts => {
  const browser = createBrowser(opts)
  exitHook(browser.close)
  return browser
}

const getBrowser = () => _browser || (_browser = initBrowser())

const getInternalBrowser = () => getBrowser().browser()

const getBrowserWSEndpoint = () => getInternalBrowser().then(browser => browser.wsEndpoint())

const getBrowserContext = () => getBrowser().createContext()

module.exports = {
  getBrowser,
  getBrowserContext,
  getBrowserWSEndpoint,
  getInternalBrowser,
  initBrowser
}

'use strict'

const createBrowser = require('browserless')
const { onExit } = require('signal-exit')

let _browser

const initBrowser = opts => {
  const browser = createBrowser(opts)
  onExit(browser.close)
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

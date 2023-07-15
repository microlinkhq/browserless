'use strict'

const { onExit } = require('signal-exit')

module.exports = opts => {
  let _browser

  const createBrowser = () => {
    const browser = require('browserless')(opts)
    onExit(browser.close)
    return browser
  }

  const getBrowser = () => _browser || (_browser = createBrowser())

  const getInternalBrowser = () => getBrowser().browser()

  const getBrowserWSEndpoint = () => getInternalBrowser().then(browser => browser.wsEndpoint())

  const getBrowserContext = async (t, opts) => {
    const browserless = await getBrowser().createContext(opts)
    t.teardown(browserless.destroyContext)
    return browserless
  }

  const getPage = async (t, opts) => {
    const browserless = await getBrowserContext(t, opts)
    const page = await browserless.page()
    t.teardown(() => page.close())
    return page
  }

  return {
    createBrowser,
    getBrowser,
    getBrowserContext,
    getBrowserWSEndpoint,
    getInternalBrowser,
    getPage
  }
}

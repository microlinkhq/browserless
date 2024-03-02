'use strict'

const { default: listen } = require('async-listen')
const { createServer } = require('http')
const { onExit } = require('signal-exit')

const closeServer = server => require('util').promisify(server.close.bind(server))()

const runServer = async (t, handler) => {
  const server = createServer(async (req, res) => {
    try {
      await handler({ req, res })
    } catch (error) {
      console.error(error)
      res.statusCode = 500
      res.end()
    }
  })
  const url = await listen(server)
  t.teardown(() => closeServer(server))
  return url
}

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
    getPage,
    runServer
  }
}

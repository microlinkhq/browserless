'use strict'

const { default: listen } = require('async-listen')
const { onExit } = require('signal-exit')
const { createServer } = require('http')
const os = require('os')

const closeServer = server => require('util').promisify(server.close.bind(server))()

let HOSTNAME = os.hostname()

// Hostname might not be always accessible in environments other than GitHub
// Actions. Therefore, we try to find an external IPv4 address to be used as a
// hostname in these tests.
const networkInterfaces = os.networkInterfaces()
for (const key of Object.keys(networkInterfaces)) {
  const interfaces = networkInterfaces[key]
  for (const net of interfaces || []) {
    if (net.family === 'IPv4' && !net.internal) {
      HOSTNAME = net.address
      break
    }
  }
}

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
  url.hostname = HOSTNAME

  t.teardown(() => closeServer(server))
  return url.toString()
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

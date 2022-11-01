'use strict'

const { initBrowser, getBrowser } = require('@browserless/test/util')
const http = require('http')

const test = require('ava')

const browser = getBrowser()

require('@browserless/test')(browser)

test('pass specific options to a context', async t => {
  const proxiedRequestUrls = []

  const proxy = http
    .createServer((req, res) => {
      proxiedRequestUrls.push(req.url)

      const proxyRequest = http.request(
        req.url,
        {
          method: req.method,
          headers: req.headers
        },
        proxyResponse => {
          res.writeHead(proxyResponse.statusCode, proxyResponse.headers)
          proxyResponse.pipe(res, { end: true })
        }
      )

      req.pipe(proxyRequest, { end: true })
    })
    .listen()

  const proxyServer = `http://[::]:${proxy.address().port}`

  const browserless = await browser.createContext({ proxyServer })
  const page = await browserless.page()

  await browserless.goto(page, { url: 'http://example.com' })

  t.deepEqual(proxiedRequestUrls, ['http://example.com/'])
})

test('ensure to destroy browser contexts', async t => {
  const browserlessFactory = initBrowser()

  const browser = await browserlessFactory.browser()

  t.is(browser.browserContexts().length, 1)

  const browserless = await browserlessFactory.createContext()

  await browserless.context()

  t.is(browser.browserContexts().length, 2)

  await browserless.destroyContext()

  t.is(browser.browserContexts().length, 1)
})

'use strict'

const { createBrowser, getBrowserContext, getBrowser } = require('@browserless/test/util')
const { request, createServer } = require('http')

const test = require('ava')

require('@browserless/test')(getBrowser())

test('pass specific options to a context', async t => {
  const proxiedRequestUrls = []

  const serverUrl = (() => {
    const server = createServer((req, res) => {
      proxiedRequestUrls.push(req.url)

      const proxyRequest = request(
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
    }).listen()

    return `http://[::]:${server.address().port}`
  })()

  const browserless = await getBrowserContext(t, { proxyServer: serverUrl })
  const page = await browserless.page()
  t.teardown(() => page.close())

  await browserless.goto(page, { url: 'http://example.com' })

  t.deepEqual(proxiedRequestUrls, ['http://example.com/'])
})

test('ensure to destroy browser contexts', async t => {
  const browserlessFactory = createBrowser()

  const browser = await browserlessFactory.browser()

  t.is(browser.browserContexts().length, 1)

  const browserless = await browserlessFactory.createContext()

  await browserless.context()

  t.is(browser.browserContexts().length, 2)

  await browserless.destroyContext()

  t.is(browser.browserContexts().length, 1)
})

test('ensure to close browser', async t => {
  const browser = require('..')()
  await browser.close()
  t.true(browser.isClosed())
})

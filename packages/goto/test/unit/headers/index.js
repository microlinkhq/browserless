'use strict'

const { createBrowser } = require('@browserless/test/util')
const { createServer } = require('http')
const test = require('ava')

const browser = createBrowser({ evasions: false })

const serverUrl = (() => {
  const server = createServer((req, res) => {
    if (req.headers.cookie) {
      const cookies = req.headers.cookie.split(';').map(cookie => cookie.trim())
      res.setHeader('set-cookie', cookies)
    }
    res.setHeader('content-type', 'application/json')
    res.end(
      JSON.stringify({
        headers: req.headers
      })
    )
  }).listen()

  return `http://[::]:${server.address().port}`
})()

const createPing = browserless =>
  browserless.evaluate(async (page, response) => {
    const userAgent = await page.evaluate(() => window.navigator.userAgent)
    const cookies = await page.cookies()
    const request = response.request()
    const body = await response.json()
    return { cookies, userAgent, body, request, response }
  })

test('set extra HTTP headers', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const ping = createPing(browserless)

  const { body, request } = await ping(serverUrl, {
    headers: {
      'x-foo': 'bar'
    }
  })

  t.is(request.headers()['x-foo'], 'bar')
  t.is(body.headers['x-foo'], 'bar')
})

test('set `uset agent` header', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const ping = createPing(browserless)

  const { userAgent, body, request } = await ping(serverUrl, {
    headers: {
      'user-agent': 'googlebot'
    }
  })

  t.is(request.headers()['user-agent'], 'googlebot')
  t.is(body.headers['user-agent'], 'googlebot')
  t.is(userAgent, 'googlebot')
})

test('set `cookie` header', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const ping = createPing(browserless)

  const { cookies, body, request } = await ping(serverUrl, {
    headers: {
      cookie: 'yummy_cookie=choco; tasty_cookie=strawberry'
    }
  })

  t.is(request.headers().cookie, 'yummy_cookie=choco; tasty_cookie=strawberry')
  t.is(body.headers.cookie, 'yummy_cookie=choco; tasty_cookie=strawberry')
  t.is(cookies.length, 2)
})

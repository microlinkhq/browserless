'use strict'

const test = require('ava')

const createBrowserless = require('browserless')

const createPing = browserless =>
  browserless.evaluate(async (page, response) => {
    const userAgent = await page.evaluate(() => window.navigator.userAgent)
    const cookies = await page.cookies()
    const request = response.request()
    const body = await response.buffer()
    return { cookies, userAgent, body, request, response }
  })

test('set extra HTTP headers', async t => {
  const browserless = createBrowserless()
  const ping = createPing(browserless)

  const { body, request } = await ping('https://httpbin.org/headers', {
    headers: {
      'X-Foo': 'bar'
    }
  })

  const headers = request.headers()
  const content = JSON.parse(body)

  t.is(headers['x-foo'], 'bar')
  t.is(content.headers['X-Foo'], 'bar')
})

test('set `uset agent` header', async t => {
  const browserless = createBrowserless({ evasions: false })
  const ping = createPing(browserless)

  const { userAgent, body, request } = await ping('https://httpbin.org/headers', {
    headers: {
      'user-agent': 'googlebot'
    }
  })

  const headers = request.headers()
  const content = JSON.parse(body)

  t.is(content.headers['User-Agent'], 'googlebot')
  t.is(headers['user-agent'], 'googlebot')
  t.is(userAgent, 'googlebot')
})

test('set `cookie` header', async t => {
  const browserless = createBrowserless()
  const ping = createPing(browserless)

  const { cookies, body, request } = await ping('https://httpbin.org/headers', {
    headers: {
      cookie: 'yummy_cookie=choco; tasty_cookie=strawberry'
    }
  })

  const headers = request.headers()
  const content = JSON.parse(body)

  t.is(content.headers.Cookie, 'yummy_cookie=choco; tasty_cookie=strawberry')
  t.is(headers.cookie, 'yummy_cookie=choco; tasty_cookie=strawberry')
  t.is(cookies.length, 2)
})

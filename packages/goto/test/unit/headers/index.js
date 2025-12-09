'use strict'

const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test/util')

const getUrl = t =>
  runServer(t, ({ req, res }) => {
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
  })

const createPing = browserless =>
  browserless.evaluate(async (page, response) => {
    const userAgent = await page.evaluate(() => window.navigator.userAgent)
    const cookies = await page.cookies()
    const request = response.request()
    const body = await response.json()
    return {
      cookies,
      userAgent,
      body,
      request,
      response
    }
  })

test('set extra HTTP headers', async t => {
  const browserless = await getBrowserContext(t)
  const ping = createPing(browserless)
  const url = await getUrl(t)
  const { body, request } = await ping(url, {
    headers: {
      'x-foo': 'bar'
    }
  })

  t.is(request.headers()['x-foo'], 'bar')
  t.is(body.headers['x-foo'], 'bar')
})

test('set `uset agent` header', async t => {
  const browserless = await getBrowserContext(t)
  const ping = createPing(browserless)
  const url = await getUrl(t)
  const { userAgent, body, request } = await ping(url, {
    headers: {
      'user-agent': 'googlebot'
    }
  })

  t.is(request.headers()['user-agent'], 'googlebot')
  t.is(body.headers['user-agent'], 'googlebot')
  t.is(userAgent, 'googlebot')
})

test('set `cookie` header', async t => {
  const browserless = await getBrowserContext(t)
  const ping = createPing(browserless)
  const url = await getUrl(t)
  const { cookies, body, request } = await ping(url, {
    headers: {
      cookie: 'yummy_cookie=choco; tasty_cookie=strawberry'
    }
  })

  t.is(request.headers().cookie, 'yummy_cookie=choco; tasty_cookie=strawberry')
  t.is(body.headers.cookie, 'yummy_cookie=choco; tasty_cookie=strawberry')
  t.is(cookies.length, 2)
})

test('does not forward cookie through extra headers', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)
  let extraHTTPHeaders

  const run = browserless.withPage((page, goto) => async () => {
    const originalSetExtraHTTPHeaders = page.setExtraHTTPHeaders.bind(page)
    page.setExtraHTTPHeaders = headers => {
      extraHTTPHeaders = headers
      return originalSetExtraHTTPHeaders(headers)
    }

    const result = await goto(page, {
      url,
      headers: {
        'x-foo': 'bar',
        cookie: 'yummy_cookie=choco'
      }
    })

    const cookies = await page.cookies(url)
    return { result, cookies }
  })

  const { cookies } = await run()

  t.truthy(extraHTTPHeaders)
  t.false(Object.prototype.hasOwnProperty.call(extraHTTPHeaders, 'cookie'))
  t.true(cookies.some(({ name, value }) => name === 'yummy_cookie' && value === 'choco'))
})

test('cookies are not sent to subrequests via extra headers', async t => {
  const browserless = await getBrowserContext(t)
  let subrequestHeaders

  const subrequestUrl = (
    await runServer(t, ({ req, res }) => {
      if (req.method === 'OPTIONS') {
        res.setHeader('access-control-allow-origin', '*')
        res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
        res.setHeader('access-control-allow-headers', 'x-foo')
        res.statusCode = 204
        return res.end()
      }

      subrequestHeaders = req.headers
      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ ok: true }))
    })
  ).replace('127.0.0.1', 'localhost')

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`
      <script>
        fetch('${subrequestUrl}').finally(() => {
          window.__subrequest_complete = true
        })
      </script>
    `)
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, {
      url,
      waitForFunction: () => window.__subrequest_complete === true,
      headers: {
        'x-foo': 'bar',
        cookie: 'secret_token=top_secret'
      }
    })

    const cookies = await page.cookies(url)
    return { cookies }
  })

  const { cookies } = await run()

  t.truthy(subrequestHeaders)
  t.is(subrequestHeaders['x-foo'], 'bar')
  t.falsy(subrequestHeaders.cookie)
  t.true(cookies.some(({ name, value }) => name === 'secret_token' && value === 'top_secret'))
})

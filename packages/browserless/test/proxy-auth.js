'use strict'

const { default: listen } = require('async-listen')
const { setTimeout } = require('timers/promises')
const { readFileSync } = require('fs')
const { default: test } = require('ava')
const https = require('https')
const http = require('http')
const path = require('path')
const net = require('net')

const createTestBrowser = require('@browserless/test/create')

const { getBrowserContext } = createTestBrowser({ timeout: 120000, acceptInsecureCerts: true })

const PROXY_USERNAME = 'proxy-user'
const PROXY_PASSWORD = 'p@ss:w/rd'
const PAGE_USERNAME = 'page-user'
const PAGE_PASSWORD = 'page-secret'
const TARGET_HOST = 'target.test'
const RETRY_WINDOW_MS = 500

const TLS = {
  key: readFileSync(path.join(__dirname, 'fixtures/target-key.pem')),
  cert: readFileSync(path.join(__dirname, 'fixtures/target-cert.pem'))
}

const basic = (username, password) =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`

const decodeBasic = header => Buffer.from(header.split(' ')[1], 'base64').toString()

const close = server =>
  new Promise(resolve => {
    server.closeAllConnections?.()
    server.close(() => resolve())
  })

const serve = async (t, server) => {
  await listen(server, 0, '127.0.0.1')
  t.teardown(() => close(server))
  return server.address().port
}

const runTarget = async (t, { secure }) => {
  const credentials = []
  const requests = []
  const handler = (req, res) => {
    requests.push(req.url)
    const { authorization } = req.headers
    if (authorization) credentials.push({ url: req.url, credentials: decodeBasic(authorization) })
    if (req.url === '/page') {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<h1>public</h1><img src="/challenge-subresource">')
    }
    if (authorization === basic(PAGE_USERNAME, PAGE_PASSWORD)) {
      res.writeHead(200, { 'content-type': 'text/html' })
      return res.end('<h1>signed in</h1>')
    }
    res.writeHead(401, { 'www-authenticate': 'Basic realm="target"' })
    res.end()
  }
  const server = secure ? https.createServer(TLS, handler) : http.createServer(handler)
  const port = await serve(t, server)
  return { credentials, requests, origin: `${secure ? 'https' : 'http'}://${TARGET_HOST}`, port }
}

const runAuthenticatedProxy = async (t, target) => {
  const seen = { authorized: 0, rejected: 0 }
  const isAuthorized = req =>
    req.headers['proxy-authorization'] === basic(PROXY_USERNAME, PROXY_PASSWORD)

  const server = http.createServer((req, res) => {
    if (!isAuthorized(req)) {
      seen.rejected++
      res.writeHead(407, { 'proxy-authenticate': 'Basic realm="proxy"' })
      return res.end()
    }
    seen.authorized++
    const { pathname } = new URL(req.url)
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: target.port,
        path: pathname,
        method: req.method,
        headers: req.headers
      },
      response => {
        res.writeHead(response.statusCode, response.headers)
        response.pipe(res)
      }
    )
    req.pipe(upstream)
  })

  server.on('connect', (req, socket, head) => {
    if (!isAuthorized(req)) {
      seen.rejected++
      return socket.end(
        'HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic realm="proxy"\r\nContent-Length: 0\r\n\r\n'
      )
    }
    seen.authorized++
    const upstream = net.connect(target.port, '127.0.0.1', () => {
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      upstream.write(head)
      upstream.pipe(socket)
      socket.pipe(upstream)
    })
    upstream.on('error', () => socket.destroy())
    socket.on('error', () => upstream.destroy())
  })

  const port = await serve(t, server)
  const credentials = `${encodeURIComponent(PROXY_USERNAME)}:${encodeURIComponent(PROXY_PASSWORD)}`
  return { seen, proxyServer: `http://${credentials}@127.0.0.1:${port}` }
}

const challengedAt = async (target, url) => {
  while (!target.requests.includes(url)) await setTimeout(50)
  await setTimeout(RETRY_WINDOW_MS)
}

const openThroughProxy = async (t, { secure }) => {
  const target = await runTarget(t, { secure })
  const proxy = await runAuthenticatedProxy(t, target)
  const browserless = await getBrowserContext(t, { proxyServer: proxy.proxyServer })
  const page = await browserless.page()
  t.teardown(() => page.close())
  return { target, proxy, browserless, page }
}

for (const secure of [false, true]) {
  const scheme = secure ? 'https' : 'http'

  test(`${scheme}: a proxy's credentials never reach a server that asks for them`, async t => {
    const { target, proxy, browserless, page } = await openThroughProxy(t, { secure })

    const { response } = await browserless.goto(page, {
      url: `${target.origin}/page`,
      adblock: false,
      waitUntil: 'domcontentloaded'
    })
    await challengedAt(target, '/challenge-subresource')
    await browserless.goto(page, { url: `${target.origin}/challenge-navigation`, adblock: false })
    await challengedAt(target, '/challenge-navigation')

    t.is(response.status(), 200)
    t.true(proxy.seen.authorized > 0)
    t.deepEqual(target.credentials, [])
  })

  test(`${scheme}: a page still answers a server with its own credentials`, async t => {
    const { target, proxy, browserless, page } = await openThroughProxy(t, { secure })

    const { response } = await browserless.goto(page, {
      url: `${target.origin}/signed-in`,
      authenticate: { username: PAGE_USERNAME, password: PAGE_PASSWORD },
      adblock: false
    })

    t.is(response.status(), 200)
    t.true(proxy.seen.authorized > 0)
    t.deepEqual(
      [...new Set(target.credentials.map(({ credentials }) => credentials))],
      [`${PAGE_USERNAME}:${PAGE_PASSWORD}`]
    )
  })
}

test('a context recreated by a retry still goes through the proxy', async t => {
  const target = await runTarget(t, { secure: false })
  const proxy = await runAuthenticatedProxy(t, target)
  const browserless = await getBrowserContext(t, { proxyServer: proxy.proxyServer })
  let attempts = 0

  const status = await browserless.withPage((page, goto) => async () => {
    if (attempts++ === 0) throw Object.assign(new Error('context reset'), { code: 'EPROTOCOL' })
    const { response } = await goto(page, {
      url: `${target.origin}/page`,
      adblock: false,
      waitUntil: 'domcontentloaded'
    })
    return response.status()
  })()

  t.is(attempts, 2)
  t.is(status, 200)
})

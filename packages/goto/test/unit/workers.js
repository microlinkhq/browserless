'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
const test = require('ava')

/**
 * Every scope must keep its high entropy user agent client hints. A browser
 * wide `--user-agent` buys a matching user agent in shared and service worker
 * scopes, but Chrome answers it by blanking `fullVersionList` everywhere the
 * per-page override does not reach, and a service worker cannot get those hints
 * back: `Network.setUserAgentOverride` on its own session is accepted without
 * effect (auto-attached or manually attached alike) and `Emulation` is not
 * available there. A Chrome user agent with an empty `fullVersionList` is
 * unreachable in real Chrome, so these assertions pin the hints instead.
 *
 * `platformVersion` is deliberately not asserted: real Chrome reports it empty
 * on Linux, so it is not comparable across hosts.
 */

const READ_HINTS = `const readHints = async () => {
  const data = navigator.userAgentData
  if (!data) return { brands: null, fullVersionList: null }
  const { fullVersionList } = await data.getHighEntropyValues(['fullVersionList'])
  return {
    brands: data.brands.map(brand => brand.brand),
    fullVersionList: (fullVersionList || []).map(brand => brand.brand + '/' + brand.version)
  }
}`

const PAGE = `<!doctype html><html><body><h1>hints</h1><script>
${READ_HINTS}
window.__hints = (async () => {
  const ask = target =>
    new Promise((resolve, reject) => {
      const channel = new MessageChannel()
      channel.port1.onmessage = event => resolve(event.data)
      setTimeout(() => reject(new Error('timeout')), 10000)
      target.postMessage('read', [channel.port2])
    })

  await fetch('/hints')

  const dedicated = await (async () => {
    const worker = new Worker('/dedicated.js')
    const hints = await ask(worker)
    worker.terminate()
    return hints
  })()

  const shared = await (async () => {
    const worker = new SharedWorker('/shared.js')
    worker.port.start()
    return new Promise((resolve, reject) => {
      worker.port.onmessage = event => resolve(event.data)
      setTimeout(() => reject(new Error('timeout')), 10000)
      worker.port.postMessage('read')
    })
  })()

  const service = await (async () => {
    const registration = await navigator.serviceWorker.register('/service.js')
    await navigator.serviceWorker.ready
    return ask(registration.active || navigator.serviceWorker.controller)
  })()

  return { page: await readHints(), dedicated, shared, service }
})()
</script></body></html>`

const DEDICATED = `${READ_HINTS}
onmessage = async event => event.ports[0].postMessage(await readHints())`

const SHARED = `${READ_HINTS}
onconnect = event => {
  const port = event.ports[0]
  port.onmessage = async () => port.postMessage(await readHints())
  port.start()
}`

const SERVICE = `${READ_HINTS}
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('message', async event =>
  event.ports[0].postMessage(await readHints())
)`

const RAW_PAGE = `<!doctype html><html><body><h1>raw</h1><script>
fetch('/hints')
</script></body></html>`

const RESOURCES = {
  '/': { type: 'text/html', body: PAGE },
  '/raw': { type: 'text/html', body: RAW_PAGE },
  '/dedicated.js': { type: 'text/javascript', body: DEDICATED },
  '/shared.js': { type: 'text/javascript', body: SHARED },
  '/service.js': { type: 'text/javascript', body: SERVICE }
}

const ACCEPT_CH = 'Sec-CH-UA, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform'

const hintsServer = (t, requests = {}) =>
  runServer(t, ({ req, res }) => {
    const path = req.url.split('?')[0]
    res.setHeader('accept-ch', ACCEPT_CH)

    if (path === '/hints') {
      requests[path] = req.headers
      res.statusCode = 204
      return res.end()
    }

    const resource = RESOURCES[path]
    if (!resource) {
      res.statusCode = 404
      return res.end()
    }

    res.setHeader('content-type', resource.type)
    res.setHeader('service-worker-allowed', '/')
    res.end(resource.body)
  })

test('every scope keeps its high entropy user agent client hints', async t => {
  const browserless = await getBrowserContext(t)
  const url = await hintsServer(t)

  const readScopes = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    return page.evaluate(() => window.__hints)
  })

  const scopes = await readScopes()

  for (const [name, { brands, fullVersionList }] of Object.entries(scopes)) {
    t.true(brands.length > 0, `${name} reports no brands`)
    t.true(fullVersionList.length > 0, `${name} reports an empty fullVersionList`)
  }
})

test('a page browserless creates sends its full version list', async t => {
  const browserless = await getBrowserContext(t)
  const requests = {}
  const url = await hintsServer(t, requests)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const hintsRequest = page.waitForResponse(response => response.url().endsWith('/hints'))
  await page.goto(`${url}raw`, { waitUntil: 'load' })
  await hintsRequest

  const fullVersionList = requests['/hints']['sec-ch-ua-full-version-list']
  t.truthy(fullVersionList)
  t.true(fullVersionList.includes('Chromium'))
})

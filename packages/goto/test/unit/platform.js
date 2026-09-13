'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
const createGetDevice = require('@browserless/devices')
const test = require('ava')

const { getClientHints } = require('../../src/client-hints')

const osFamily = value =>
  /win/i.test(value)
    ? 'windows'
    : /android|arm|linux|cros|x11/i.test(value)
      ? 'linux'
      : /mac|iphone|ipad|ipod/i.test(value)
        ? 'apple'
        : 'other'

const READ = 'const read = () => ({ platform: navigator.platform, userAgent: navigator.userAgent })'

const WORKERS_PAGE = `<!doctype html><html><body><h1>platform</h1><script>
${READ}
window.__report = (async () => {
  const ask = target => new Promise((resolve, reject) => {
    const channel = new MessageChannel()
    channel.port1.onmessage = event => resolve(event.data)
    setTimeout(() => reject(new Error('timeout')), 8000)
    target.postMessage('read', [channel.port2])
  })

  const dedicated = await (async () => {
    try {
      const worker = new Worker('/worker.js')
      const value = await ask(worker)
      worker.terminate()
      return value
    } catch (error) { return { error: error.message } }
  })()

  const shared = await (async () => {
    try {
      const worker = new SharedWorker('/shared.js')
      worker.port.start()
      const value = await new Promise((resolve, reject) => {
        worker.port.onmessage = event => resolve(event.data)
        setTimeout(() => reject(new Error('timeout')), 8000)
        worker.port.postMessage('read')
      })
      worker.port.close()
      return value
    } catch (error) { return { error: error.message } }
  })()

  const service = await (async () => {
    let registration
    try {
      registration = await navigator.serviceWorker.register('/service-worker.js')
      await navigator.serviceWorker.ready
      const active = registration.active || navigator.serviceWorker.controller
      return active ? await ask(active) : { error: 'no active service worker' }
    } catch (error) {
      return { error: error.message }
    } finally {
      if (registration) await registration.unregister().catch(() => {})
    }
  })()

  return { page: read(), dedicated, shared, service }
})()
</script></body></html>`

const PLAIN_PAGE = `<!doctype html><html><body><h1>plain</h1><script>
${READ}
window.__report = Promise.resolve({ page: read() })
</script></body></html>`

const BODIES = {
  '/': { type: 'text/html', body: WORKERS_PAGE },
  '/plain': { type: 'text/html', body: PLAIN_PAGE },
  '/worker.js': {
    type: 'text/javascript',
    body: `${READ}\nonmessage = event => event.ports[0].postMessage(read())`
  },
  '/shared.js': {
    type: 'text/javascript',
    body: `${READ}\nonconnect = event => {
  const port = event.ports[0]
  port.onmessage = () => port.postMessage(read())
  port.start()
}`
  },
  '/service-worker.js': {
    type: 'text/javascript',
    body: `${READ}
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))
self.addEventListener('message', event => event.ports[0].postMessage(read()))`
  }
}

const platformServer = (t, requests = []) =>
  runServer(t, ({ req, res }) => {
    const path = req.url.split('?')[0]
    requests.push({ path, headers: req.headers })
    const entry = BODIES[path]
    if (!entry) {
      res.statusCode = 404
      return res.end()
    }
    res.setHeader('content-type', entry.type)
    res.setHeader('service-worker-allowed', '/')
    res.end(entry.body)
  })

const readReport = (browserless, url, args = {}) =>
  browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false, ...args })
    return page.evaluate(() => window.__report)
  })()

test('the default device reports the host platform in every scope', async t => {
  const browserless = await getBrowserContext(t)
  const requests = []
  const url = await platformServer(t, requests)

  const report = await readReport(browserless, url)
  const hints = getClientHints(report.page.userAgent)

  for (const scope of ['dedicated', 'shared', 'service']) {
    t.is(report[scope].error, undefined, scope)
    t.is(report[scope].platform, report.page.platform, scope)
  }

  t.is(osFamily(report.page.userAgent), osFamily(report.page.platform))
  t.is(
    osFamily(report.page.platform),
    osFamily(createGetDevice.hostDesktopPlatform(process.platform))
  )
  t.is(hints.platform, report.page.platform)
  t.is(osFamily(hints.userAgentMetadata.platform), osFamily(report.page.platform))

  const document = requests.find(({ path }) => path === '/')
  t.is(document.headers['sec-ch-ua-platform'], `"${hints.userAgentMetadata.platform}"`)
})

test('a named device still emulates that device', async t => {
  const browserless = await getBrowserContext(t)
  const url = await platformServer(t)

  const report = await readReport(browserless, `${url}plain`, { device: 'Galaxy S8' })

  t.is(report.page.platform, 'Linux armv8l')
  t.true(report.page.userAgent.includes('Android'))
  t.true(report.page.userAgent.includes('SM-G950U'))
})

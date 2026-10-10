'use strict'

const createTestUtil = require('@browserless/test/create')
const puppeteer = require('@cloudflare/puppeteer')
const { setTimeout } = require('timers/promises')
const { WebSocket } = require('ws')
const { once } = require('events')
const test = require('ava')

const cdpGateway = require('../../src/sandbox/gateway')

const { getBrowser } = createTestUtil({ pipe: true })

const OWN_PAGE_URL = 'data:text/html,<title>own</title><input type=file id=upload>'
const OTHER_PAGE_URL = 'data:text/html,<title>other-tenant</title>'
const LOCAL_FILE = '/etc/hosts'
const NOT_AVAILABLE = method => `'${method}' is not available to functions`
const INVALID_PARAMS = { code: -32602, message: 'Invalid parameters' }
const LARGE_REPLY_BYTES = 80 * 1024 * 1024
const FLOOD_TIMEOUT_MS = 30_000

test.after.always(() => cdpGateway.close())

const pWaitFor = async (condition, { timeout }) => {
  const deadline = Date.now() + timeout
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Condition not met within ${timeout}ms`)
    await setTimeout(50)
  }
}

const openPage = async (t, url) => {
  const browserless = await getBrowser().createContext()
  t.teardown(() => browserless.destroyContext())
  const page = await (await browserless.context()).newPage()
  await page.goto(url)
  return page
}

const openGrant = async (t, page) => {
  const grant = await cdpGateway.grant(page)
  t.teardown(() => grant.revoke())
  return grant
}

const targetIdOf = async page => {
  const session = await page.createCDPSession()
  const { targetInfo } = await session.send('Target.getTargetInfo')
  await session.detach()
  return targetInfo.targetId
}

const windowIdOf = async page => {
  const session = await page.createCDPSession()
  const { windowId } = await session.send('Browser.getWindowForTarget')
  await session.detach()
  return windowId
}

const attachToOwnPage = async ({ send, events }) => {
  await send('Target.setAutoAttach', {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: false
  })
  return events.find(event => event.method === 'Target.attachedToTarget').params.sessionId
}

const openSocket = async (endpoint, options) => {
  const socket = new WebSocket(endpoint, options)
  await once(socket, 'open')
  return socket
}

const refusalOf = async (endpoint, options) => {
  const socket = new WebSocket(endpoint, options)
  const [error] = await once(socket, 'error')
  return error.message
}

const rawClient = async (t, endpoint) => {
  const socket = await openSocket(endpoint)
  t.teardown(() => socket.terminate())
  const replies = new Map()
  const events = []
  let lastId = 0
  socket.on('message', data => {
    const message = JSON.parse(data)
    if (message.id === undefined) return events.push(message)
    replies.get(message.id)(message)
  })
  const send = (method, params, sessionId) =>
    new Promise(resolve => {
      const id = ++lastId
      replies.set(id, resolve)
      socket.send(JSON.stringify({ id, method, params, sessionId }))
    })
  return { socket, send, events }
}

const puppeteerClient = async (t, endpoint) => {
  const browser = await puppeteer.connect({ browserWSEndpoint: endpoint })
  t.teardown(() => browser.disconnect().catch(() => {}))
  return browser
}

const scenario = async t => {
  const otherPage = await openPage(t, OTHER_PAGE_URL)
  const ownPage = await openPage(t, OWN_PAGE_URL)
  const grant = await openGrant(t, ownPage)
  return { otherPage, ownPage, grant }
}

const messageOf = promise =>
  promise.then(
    () => undefined,
    error => error?.message
  )

test('a page in the default browser context gets no grant', async t => {
  const browser = await getBrowser().browser()
  const page = await browser.newPage()
  t.teardown(() => page.close())
  await t.throwsAsync(cdpGateway.grant(page), {
    message: 'A function page needs its own browser context'
  })
})

test('a connection without a granted token is refused', async t => {
  const { grant } = await scenario(t)
  const { origin } = new URL(grant.endpoint)
  t.is(await refusalOf(`${origin}/`), 'Unexpected server response: 401')
  t.is(await refusalOf(`${origin}/${'0'.repeat(64)}`), 'Unexpected server response: 401')
})

test('a web page cannot use a grant', async t => {
  const { grant } = await scenario(t)
  t.is(
    await refusalOf(grant.endpoint, { origin: 'https://example.com' }),
    'Unexpected server response: 401'
  )
})

test('a grant serves one connection at a time', async t => {
  const { grant } = await scenario(t)
  const first = await openSocket(grant.endpoint)
  t.is(await refusalOf(grant.endpoint), 'Unexpected server response: 401')
  first.close()
  await once(first, 'close')
  const second = await openSocket(grant.endpoint)
  second.terminate()
  t.pass()
})

test('a revoked grant closes its connection and refuses a new one', async t => {
  const { grant } = await scenario(t)
  const socket = await openSocket(grant.endpoint)
  const closed = once(socket, 'close')
  await grant.revoke()
  await closed
  t.is(await refusalOf(grant.endpoint), 'Unexpected server response: 401')
})

test('revoking a grant cuts off a client that stopped reading', async t => {
  const { grant } = await scenario(t)
  const server = await cdpGateway.listen()
  const socket = await openSocket(grant.endpoint)
  t.teardown(() => socket.terminate())
  const serverSide = [...server.clients].at(-1)
  socket._socket.pause()

  let isRevoked = false
  grant.revoke().then(() => {
    isRevoked = true
  })
  await pWaitFor(() => isRevoked, { timeout: 5000 })

  t.is(serverSide.readyState, WebSocket.CLOSED)
})

test('a page that cannot open a devtools session closes the connection, not the process', async t => {
  const brokenPage = {
    browser: () => ({
      target: () => ({
        createCDPSession: async () => {
          throw new Error('Browser target is not found')
        }
      })
    }),
    browserContext: () => ({ id: 'a-context' })
  }
  const grant = await openGrant(t, brokenPage)
  const socket = await openSocket(grant.endpoint)

  const [code] = await once(socket, 'close')

  t.is(code, 1011)
})

test('a client discovers only the targets of its own browser context', async t => {
  const { ownPage, otherPage, grant } = await scenario(t)
  const ownContextId = ownPage.browserContext().id
  const ownTargetId = await targetIdOf(ownPage)
  const otherTargetId = await targetIdOf(otherPage)
  const { send, events } = await rawClient(t, grant.endpoint)

  t.deepEqual((await send('Target.getBrowserContexts')).result, {
    browserContextIds: [ownContextId]
  })

  await send('Target.setDiscoverTargets', { discover: true, filter: [{}] })
  const discovered = events
    .filter(event => event.method === 'Target.targetCreated')
    .map(event => event.params.targetInfo)
  const foreign = discovered.filter(
    info => info.type !== 'browser' && info.browserContextId !== ownContextId
  )
  t.true(discovered.some(info => info.targetId === ownTargetId))
  t.deepEqual(foreign, [])

  const { targetInfos } = (await send('Target.getTargets')).result
  t.true(targetInfos.some(info => info.targetId === ownTargetId))
  t.false(targetInfos.some(info => info.targetId === otherTargetId))
  t.true(targetInfos.every(info => info.browserContextId === ownContextId))
})

test('a target created later by another context is never announced', async t => {
  const { grant } = await scenario(t)
  const { send, events } = await rawClient(t, grant.endpoint)
  await send('Target.setDiscoverTargets', { discover: true, filter: [{}] })
  await send('Target.setAutoAttach', {
    autoAttach: true,
    flatten: true,
    waitForDebuggerOnStart: true
  })

  await openPage(t, 'data:text/html,<title>late-tenant</title>')
  await send('Browser.getVersion')

  t.false(JSON.stringify(events).includes('late-tenant'))
})

test('another context cannot be attached to, closed or read', async t => {
  const { otherPage, grant } = await scenario(t)
  const otherTargetId = await targetIdOf(otherPage)
  const otherContextId = otherPage.browserContext().id
  await otherPage.setCookie({ name: 'session', value: 'other-tenant', url: 'https://example.com' })
  const { send } = await rawClient(t, grant.endpoint)

  for (const method of ['Target.attachToTarget', 'Target.closeTarget', 'Target.activateTarget']) {
    const { error } = await send(method, { targetId: otherTargetId })
    t.is(error.message, 'No target with given id found', method)
  }
  t.is(
    (await send('Target.getTargetInfo', { targetId: otherTargetId })).error.message,
    'No target with given id found'
  )
  t.is(
    (await send('Storage.getCookies', { browserContextId: otherContextId })).error.message,
    `Failed to find browser context with id ${otherContextId}`
  )
  t.deepEqual((await send('Storage.getCookies')).result, { cookies: [] })
  t.is(
    (await send('Target.createTarget', { url: 'about:blank', browserContextId: otherContextId }))
      .error.message,
    `Failed to find browser context with id ${otherContextId}`
  )
  t.false(otherPage.isClosed())
})

test('a session the client was never given cannot be driven', async t => {
  const { otherPage, grant } = await scenario(t)
  const foreignSession = await otherPage.createCDPSession()
  t.teardown(() => foreignSession.detach().catch(() => {}))
  const { send } = await rawClient(t, grant.endpoint)

  const { error } = await send(
    'Runtime.evaluate',
    { expression: 'document.title' },
    foreignSession.id()
  )

  t.deepEqual(error, { code: -32001, message: 'Session with given id not found.' })
})

test("another request's window cannot be resized or minimized", async t => {
  const { otherPage, grant } = await scenario(t)
  const otherWindowId = await windowIdOf(otherPage)
  const client = await rawClient(t, grant.endpoint)
  const sessionId = await attachToOwnPage(client)

  const { error } = await client.send(
    'Browser.setWindowBounds',
    { windowId: otherWindowId, bounds: { windowState: 'minimized' } },
    sessionId
  )

  t.is(error.message, NOT_AVAILABLE('Browser.setWindowBounds'))
  t.is(await otherPage.evaluate(() => document.visibilityState), 'visible')
})

test("another request's screen cannot be changed", async t => {
  const { otherPage, grant } = await scenario(t)
  const hostSession = await otherPage.createCDPSession()
  t.teardown(() => hostSession.detach().catch(() => {}))
  const { screenInfos } = await hostSession.send('Emulation.getScreenInfos')
  const primary = screenInfos.find(screen => screen.isPrimary)
  t.teardown(() =>
    hostSession
      .send('Emulation.updateScreen', {
        screenId: primary.id,
        width: primary.width,
        height: primary.height
      })
      .catch(() => {})
  )
  const screenSize = () =>
    otherPage.evaluate(() => `${window.screen.width}x${window.screen.height}`)
  const sizeBefore = await screenSize()
  const client = await rawClient(t, grant.endpoint)
  const sessionId = await attachToOwnPage(client)

  for (const [method, params] of [
    ['Emulation.updateScreen', { screenId: primary.id, width: 320, height: 240 }],
    ['Emulation.addScreen', { left: 2000, top: 0, width: 640, height: 480 }],
    ['Emulation.setPrimaryScreen', { screenId: primary.id }],
    ['Emulation.removeScreen', { screenId: 'missing' }],
    ['Emulation.getScreenInfos', {}]
  ]) {
    const { error } = await client.send(method, params, sessionId)
    t.is(error?.message, NOT_AVAILABLE(method), method)
  }

  t.is(await screenSize(), sizeBefore)
})

test('browser-level commands a function has no use for are refused', async t => {
  const { grant } = await scenario(t)
  const { send } = await rawClient(t, grant.endpoint)

  for (const method of [
    'Target.attachToBrowserTarget',
    'Target.createBrowserContext',
    'Target.exposeDevToolsProtocol',
    'Browser.setDownloadBehavior',
    'Browser.crash',
    'SystemInfo.getInfo',
    'Tracing.start',
    'IO.read'
  ]) {
    t.is((await send(method)).error.message, NOT_AVAILABLE(method))
  }
})

test('local files are out of reach of a puppeteer client', async t => {
  const { grant } = await scenario(t)
  const browser = await puppeteerClient(t, grant.endpoint)
  const [page] = await browser.pages()
  const session = await page.createCDPSession()
  const { frameTree } = await session.send('Page.getFrameTree')
  const upload = await page.$('#upload')

  t.true(
    (await messageOf(upload.uploadFile(LOCAL_FILE))).includes(
      NOT_AVAILABLE('DOM.setFileInputFiles')
    )
  )
  t.is(await page.$eval('#upload', input => input.files.length), 0)

  const refusedNavigation = 'only accepts http, https, data, blob and about:blank URLs'
  t.true((await messageOf(page.goto(`file://${LOCAL_FILE}`))).includes(refusedNavigation))
  t.true((await messageOf(page.goto('chrome://version'))).includes(refusedNavigation))
  const browserLevelSession = browser.target().createCDPSession()
  t.true((await messageOf(browserLevelSession)).includes('No target with given id found'))

  const loadLocalFile = session.send('Network.loadNetworkResource', {
    frameId: frameTree.frame.id,
    url: `file://${LOCAL_FILE}`,
    options: { disableCache: true, includeCredentials: false }
  })
  t.true((await messageOf(loadLocalFile)).includes(NOT_AVAILABLE('Network.loadNetworkResource')))

  const dropLocalFile = session.send('Input.dispatchDragEvent', {
    type: 'drop',
    x: 10,
    y: 10,
    data: { items: [], files: [LOCAL_FILE], dragOperationsMask: 1 }
  })
  t.true((await messageOf(dropLocalFile)).includes('cannot carry local files'))

  const downloadAnywhere = session.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: '/tmp'
  })
  t.true((await messageOf(downloadAnywhere)).includes(NOT_AVAILABLE('Page.setDownloadBehavior')))

  t.is(page.url(), OWN_PAGE_URL)
})

test('a puppeteer client sees and drives only its own page', async t => {
  const { otherPage, grant } = await scenario(t)
  const browser = await puppeteerClient(t, grant.endpoint)

  const pages = await browser.pages()
  t.deepEqual(
    pages.map(page => page.url()),
    [OWN_PAGE_URL]
  )

  const [page] = pages
  t.is(await page.title(), 'own')
  await page.setContent('<title>rewritten</title><h1>hello</h1>')
  t.is(await page.$eval('h1', heading => heading.textContent), 'hello')
  t.true((await page.screenshot()).length > 0)
  t.true((await page.pdf()).length > 0)

  await page.setRequestInterception(true)
  page.on('request', request =>
    request.respond({ contentType: 'text/html', body: '<title>intercepted</title>' })
  )
  await page.goto('https://example.com/')
  t.is(await page.title(), 'intercepted')
  await page.setCookie({ name: 'own', value: 'cookie' })
  t.deepEqual(
    (await page.cookies()).map(cookie => cookie.name),
    ['own']
  )

  t.is(await otherPage.title(), 'other-tenant')
  t.deepEqual(await otherPage.cookies('https://example.com/'), [])
})

test('a page the client opens lands in its own browser context', async t => {
  const { ownPage, grant } = await scenario(t)
  const browser = await puppeteerClient(t, grant.endpoint)

  const opened = await browser.newPage()
  await opened.goto('data:text/html,<title>opened</title>')

  t.is(await opened.title(), 'opened')
  t.is((await browser.pages()).length, 2)
  t.is((await ownPage.browserContext().pages()).length, 2)
  await opened.close()
  t.is((await ownPage.browserContext().pages()).length, 1)
})

test('a page with a worker and a cross-site frame still connects', async t => {
  const page = await openPage(
    t,
    'data:text/html,<iframe src="https://example.com/"></iframe>' +
      '<script>new Worker(URL.createObjectURL(new Blob(["1"])))</script>'
  )
  await page.waitForFrame(frame => frame.url() === 'https://example.com/')
  const grant = await openGrant(t, page)
  const browser = await puppeteerClient(t, grant.endpoint)

  const [connected] = await browser.pages()

  t.deepEqual(
    connected
      .frames()
      .map(frame => frame.url())
      .sort(),
    [page.url(), 'https://example.com/'].sort()
  )
  t.is(
    await connected
      .frames()
      .find(frame => frame.url() === 'https://example.com/')
      .evaluate(() => document.title),
    'Example Domain'
  )
})

test('closing the browser ends the client view and nothing else', async t => {
  const { ownPage, otherPage, grant } = await scenario(t)
  const browser = await puppeteerClient(t, grant.endpoint)
  const disconnected = once(browser, 'disconnected')

  await browser.close()
  await disconnected

  t.false(browser.connected)
  t.is(await ownPage.title(), 'own')
  t.is(await otherPage.title(), 'other-tenant')
  t.true((await getBrowser().browser()).connected)
})

test('a message that is not a command gets an error and keeps the connection', async t => {
  const { grant } = await scenario(t)
  const { socket, send, events } = await rawClient(t, grant.endpoint)

  for (const malformed of [
    'not json',
    '[]',
    '{"id":"1","method":"Browser.getVersion"}',
    '{"id":1}'
  ]) {
    socket.send(malformed)
  }
  const { result } = await send('Browser.getVersion')

  t.truthy(result.product)
  t.deepEqual(
    events.map(event => event.error),
    Array(4).fill({ code: -32600, message: 'Message must be a valid command' })
  )
})

test('a malformed target filter is refused and discovery keeps working', async t => {
  const { grant } = await scenario(t)
  const { send, events } = await rawClient(t, grant.endpoint)

  for (const filter of ['x', [null]]) {
    for (const [method, params] of [
      ['Target.setDiscoverTargets', { discover: true, filter }],
      ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, filter }]
    ]) {
      t.deepEqual((await send(method, params)).error, INVALID_PARAMS, method)
    }
  }
  await send('Target.setDiscoverTargets', { discover: true, filter: [{}] })
  const { targetId } = (await send('Target.createTarget', { url: 'about:blank' })).result
  const isAnnounced = () =>
    events.some(
      ({ method, params }) =>
        method === 'Target.targetCreated' && params.targetInfo.targetId === targetId
    )
  await pWaitFor(isAnnounced, { timeout: 5000 })

  t.true(isAnnounced())
})

test('a client that keeps reading gets a reply larger than the backlog allowance', async t => {
  const { grant } = await scenario(t)
  const browser = await puppeteerClient(t, grant.endpoint)
  const [page] = await browser.pages()
  page.on('console', () => {})
  await page.evaluate(() => {
    setInterval(() => console.log('n'.repeat(1024)), 1)
  })

  const reply = await page.evaluate(length => 'x'.repeat(length), LARGE_REPLY_BYTES)

  t.is(reply.length, LARGE_REPLY_BYTES)
})

test('a client that stops reading is cut off instead of buffered without limit', async t => {
  const { grant } = await scenario(t)
  const server = await cdpGateway.listen()
  const client = await rawClient(t, grant.endpoint)
  const sessionId = await attachToOwnPage(client)
  await client.send('Runtime.enable', {}, sessionId)
  const serverSide = [...server.clients].at(-1)
  const closed = once(serverSide, 'close')

  client.socket._socket.pause()
  client.send(
    'Runtime.evaluate',
    {
      expression:
        'setInterval(() => { for (let i = 0; i < 16; i++) console.log("x".repeat(1024 * 1024)) }, 10)'
    },
    sessionId
  )
  await pWaitFor(() => serverSide.readyState === WebSocket.CLOSED, { timeout: FLOOD_TIMEOUT_MS })

  const [code] = await closed
  t.is(code, 1006)
})

test('a revoked client that was intercepting requests no longer holds the page', async t => {
  const { ownPage, grant } = await scenario(t)
  const browser = await puppeteer.connect({ browserWSEndpoint: grant.endpoint })
  const [page] = await browser.pages()
  await page.setRequestInterception(true)

  await grant.revoke()
  await ownPage.goto('https://example.com/')

  t.is(await ownPage.title(), 'Example Domain')
})

test('a grant is released only once its sessions are gone from the host connection', async t => {
  const page = await openPage(
    t,
    'data:text/html,<iframe src="https://example.com/"></iframe>' +
      '<script>new Worker(URL.createObjectURL(new Blob(["1"])))</script>'
  )
  await page.waitForFrame(frame => frame.url() === 'https://example.com/')
  const hostSessions = (await getBrowser().browser())._connection._sessions
  const sessionsBeforeTheGrant = hostSessions.size
  const grant = await cdpGateway.grant(page)
  const browser = await puppeteer.connect({ browserWSEndpoint: grant.endpoint })
  await browser.pages()
  t.true(hostSessions.size > sessionsBeforeTheGrant)

  await grant.revoke()

  t.is(hostSessions.size, sessionsBeforeTheGrant)
})

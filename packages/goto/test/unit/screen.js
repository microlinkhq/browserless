'use strict'

const test = require('ava')
const createGoto = require('../../src')

const METRICS_OVERRIDE = 'Emulation.setDeviceMetricsOverride'
const DEFAULT_VIEWPORT = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 2,
  isMobile: false,
  hasTouch: false,
  isLandscape: false
}

const createConnection = () => {
  const sent = []
  const sessions = new Map()
  let installs = 0
  let rawSend = (callbacks, method, params, sessionId) => {
    sent.push({ method, params, sessionId })
    return Promise.resolve()
  }
  const connection = {
    sent,
    get installs () {
      return installs
    },
    get _rawSend () {
      return rawSend
    },
    set _rawSend (fn) {
      installs += 1
      rawSend = fn
    },
    session: id => sessions.get(id),
    createSession: (id, parentId) => {
      const session = {
        id: () => id,
        connection: () => connection,
        parentSession: () => sessions.get(parentId),
        once: () => {},
        send: (method, params) => connection._rawSend(undefined, method, params, id)
      }
      sessions.set(id, session)
      return session
    }
  }
  return connection
}

const createPage = (connection, sessionId, viewport = DEFAULT_VIEWPORT) => {
  let current = viewport
  const noop = () => Promise.resolve()
  const browser = { version: () => Promise.resolve('Chrome/152.0.7977.83') }
  const page = {
    session: connection.createSession(sessionId),
    setViewport: async next => {
      current = next
      await page.session.send(METRICS_OVERRIDE, {
        mobile: Boolean(next.isMobile),
        width: next.width,
        height: next.height,
        deviceScaleFactor: next.deviceScaleFactor ?? 1
      })
    },
    viewport: () => current,
    setExtraHTTPHeaders: noop,
    setUserAgent: noop,
    emulateMediaFeatures: noop,
    addStyleTag: noop,
    goto: () => Promise.resolve(null),
    waitForNetworkIdle: noop,
    browser: () => browser,
    _client: () => page.session
  }
  return page
}

const overrides = (connection, sessionId) =>
  connection.sent
    .filter(call => call.method === METRICS_OVERRIDE && call.sessionId === sessionId)
    .map(
      ({ params }) =>
        `${params.width}x${params.height} screen ${params.screenWidth}x${params.screenHeight}`
    )

const navigate = (goto, page, opts) =>
  goto(page, { url: 'about:blank', waitUntil: 'load', adblock: false, ...opts })

test('the metrics interceptor is installed once per connection', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  const pages = [createPage(connection, 'a'), createPage(connection, 'b')]

  for (const page of pages) {
    await navigate(goto, page)
    await navigate(goto, page)
  }

  t.is(connection.installs, 1)
})

test('a desktop page gets its screen once, not on every navigation', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  const page = createPage(connection, 'a')

  await navigate(goto, page)
  await navigate(goto, page)
  await navigate(goto, page)

  t.deepEqual(overrides(connection, 'a'), ['1280x800 screen 1440x900'])
})

test('every metrics override on a tracked session carries the screen', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  const page = createPage(connection, 'a')

  await navigate(goto, page)
  await page.setViewport(page.viewport())
  await page.session.send(METRICS_OVERRIDE, {
    mobile: false,
    width: 1920,
    height: 1200,
    deviceScaleFactor: 1
  })

  t.deepEqual(overrides(connection, 'a'), [
    '1280x800 screen 1440x900',
    '1280x800 screen 1440x900',
    '1920x1200 screen 2560x1440'
  ])
})

test('sessions attached under a tracked session carry the screen after a swap', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  const page = createPage(connection, 'primary')

  await navigate(goto, page)
  const prerender = connection.createSession('prerender', 'primary')
  await prerender.send(METRICS_OVERRIDE, {
    mobile: false,
    width: 1280,
    height: 800,
    deviceScaleFactor: 2
  })
  page.session = prerender
  await navigate(goto, page)

  t.deepEqual(overrides(connection, 'prerender'), ['1280x800 screen 1440x900'])
})

test('a prerender attached to the same tab carries the screen, other tabs do not', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  connection.createSession('tab')
  connection.createSession('other-tab')
  const page = createPage(connection, 'primary')
  page.session = connection.createSession('primary', 'tab')
  const prerender = connection.createSession('prerender', 'tab')
  const otherPage = connection.createSession('other-page', 'other-tab')

  await navigate(goto, page)
  const metrics = { mobile: false, width: 1280, height: 800, deviceScaleFactor: 2 }
  await prerender.send(METRICS_OVERRIDE, metrics)
  await otherPage.send(METRICS_OVERRIDE, metrics)
  page.session = prerender
  await navigate(goto, page)

  t.deepEqual(overrides(connection, 'prerender'), ['1280x800 screen 1440x900'])
  t.deepEqual(overrides(connection, 'other-page'), ['1280x800 screen undefinedxundefined'])
})

test('mobile overrides, explicit screens and untracked pages are left untouched', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  const page = createPage(connection, 'a')
  const untracked = connection.createSession('untracked')

  await navigate(goto, page)
  await page.session.send(METRICS_OVERRIDE, {
    mobile: true,
    width: 393,
    height: 659,
    deviceScaleFactor: 3
  })
  await page.session.send(METRICS_OVERRIDE, {
    mobile: false,
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    screenWidth: 1600,
    screenHeight: 1000
  })
  await untracked.send(METRICS_OVERRIDE, {
    mobile: false,
    width: 1280,
    height: 800,
    deviceScaleFactor: 1
  })

  t.deepEqual(overrides(connection, 'a').slice(1), [
    '393x659 screen undefinedxundefined',
    '1280x800 screen 1600x1000'
  ])
  t.deepEqual(overrides(connection, 'untracked'), ['1280x800 screen undefinedxundefined'])
})

test('a default navigation keeps a desktop viewport the page already has', async t => {
  const goto = createGoto({ timeout: 10000 })
  const connection = createConnection()
  const page = createPage(connection, 'a', { width: 1024, height: 700 })

  await navigate(goto, page)

  t.deepEqual(page.viewport(), { width: 1024, height: 700 })
  t.deepEqual(overrides(connection, 'a'), ['1024x700 screen 1366x768'])
})

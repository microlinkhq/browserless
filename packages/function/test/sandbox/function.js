'use strict'

const createTestUtil = require('@browserless/test/create')
const { setTimeout } = require('timers/promises')
const test = require('ava')

const gateway = require('../../src/sandbox/gateway')
const browserlessFunction = require('../..')()

const { getBrowser } = createTestUtil({ pipe: true })

const OWN_PAGE_URL = 'data:text/html,<title>own</title><input type=file id=upload>'
const FILE_INPUT_DENIAL = "'DOM.setFileInputFiles' is not available to functions"

const opts = { getBrowserless: () => getBrowser(), timeout: 120000 }

const SET_LOCAL_FILE = `async ({ page }) => {
  const client = await page.createCDPSession()
  const { root } = await client.send('DOM.getDocument')
  const { nodeId } = await client.send('DOM.querySelector', {
    nodeId: root.nodeId,
    selector: '#upload'
  })
  await client.send('DOM.setFileInputFiles', { nodeId, files: ['/etc/hosts'] })
}`

const openPage = async (t, url) => {
  const context = await getBrowser().createContext()
  t.teardown(() => context.destroyContext())
  const page = await context.page()
  await page.goto(url)
  return page
}

const waitFor = async (condition, timeout = 5000) => {
  const deadline = Date.now() + timeout
  while (!condition() && Date.now() < deadline) await setTimeout(50)
}

test('a denied command fails the function as a SandboxError', async t => {
  const { isFulfilled, value, profiling } = await browserlessFunction(
    SET_LOCAL_FILE,
    opts
  )(OWN_PAGE_URL)

  t.false(isFulfilled)
  t.deepEqual(value, { name: 'SandboxError', message: FILE_INPUT_DENIAL })
  t.truthy(profiling)
})

test('a navigation to a local file is refused', async t => {
  const { isFulfilled, value } = await browserlessFunction(
    ({ page }) => page.goto('file:///etc/hosts'),
    opts
  )(OWN_PAGE_URL)

  t.false(isFulfilled)
  t.deepEqual(value, {
    name: 'SandboxError',
    message: "'Page.navigate' only accepts http, https, about, data and blob URLs"
  })
})

test('every refused command reaches onDenied, even one the function recovers from', async t => {
  const denied = []
  const result = await browserlessFunction(
    async ({ page }) => {
      const client = await page.createCDPSession()
      await client.send('Tracing.start').catch(() => {})
      return page.title()
    },
    { ...opts, onDenied: event => denied.push(event) }
  )(OWN_PAGE_URL)

  t.true(result.isFulfilled)
  t.is(result.value, 'own')
  t.deepEqual(denied, [
    { method: 'Tracing.start', reason: "'Tracing.start' is not available to functions" }
  ])
})

test('a function sees only the pages of its own browser context', async t => {
  await openPage(t, 'data:text/html,<title>another-call</title>')

  const result = await browserlessFunction(async ({ page }) => {
    const pages = await page.browser().pages()
    return Promise.all(pages.map(open => open.title()))
  }, opts)(OWN_PAGE_URL)

  t.true(result.isFulfilled)
  t.deepEqual(result.value, ['own'])
})

test('a function closing the browser leaves it open for the next call', async t => {
  const closing = await browserlessFunction(
    ({ page }) => page.browser().close(),
    opts
  )(OWN_PAGE_URL)
  const next = await browserlessFunction(({ page }) => page.title(), opts)(OWN_PAGE_URL)

  t.true(closing.isFulfilled)
  t.is(next.value, 'own')
  t.true((await getBrowser().browser()).connected)
})

test('a denied command on a supplied page fails the function, not the call', async t => {
  const page = await openPage(t, OWN_PAGE_URL)

  const { isFulfilled, value } = await browserlessFunction(SET_LOCAL_FILE, {
    getPage: async () => ({ page }),
    retry: 0,
    timeout: 120000
  })(OWN_PAGE_URL)

  t.false(isFulfilled)
  t.deepEqual(value, { name: 'SandboxError', message: FILE_INPUT_DENIAL })
})

test('a supplied page in the default browser context is refused', async t => {
  const page = await (await getBrowser().browser()).newPage()
  t.teardown(() => page.close())

  await t.throwsAsync(
    browserlessFunction(({ page }) => page.title(), {
      getPage: async () => ({ page }),
      timeout: 120000
    })('about:blank'),
    { message: 'A function page needs its own browser context' }
  )
})

test('a call that times out cuts its function off the browser', async t => {
  const page = await openPage(t, OWN_PAGE_URL)
  const server = await gateway.listen()

  const call = browserlessFunction(
    '({ page }) => page.waitForSelector("#never-matches", { timeout: 0 })',
    { getPage: async () => ({ page }), timeout: 5000 }
  )(OWN_PAGE_URL)
  await waitFor(() => server.clients.size === 1)
  const connectedBeforeTimeout = server.clients.size
  const error = await t.throwsAsync(call)

  t.is(connectedBeforeTimeout, 1)
  t.is(error.code, 'EBRWSRTIMEOUT')
  t.is(server.clients.size, 0)
  t.false(page.isClosed())
})

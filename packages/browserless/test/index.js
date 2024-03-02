'use strict'

const { setTimeout } = require('timers/promises')
const { request } = require('http')
const $ = require('tinyspawn')
const path = require('path')
const ava = require('ava')

const {
  runServer,
  createBrowser,
  getBrowserContext,
  getBrowser
} = require('@browserless/test/util')

const test = process.env.CI ? ava.serial : ava

require('@browserless/test')(getBrowser())
test('pass specific options to a context', async t => {
  const proxiedRequestUrls = []

  const proxyServer = await runServer(t, async ({ req, res }) => {
    proxiedRequestUrls.push(req.url)

    const proxyRequest = request(
      req.url,
      {
        method: req.method,
        headers: req.headers
      },
      proxyResponse => {
        res.writeHead(proxyResponse.statusCode, proxyResponse.headers)
        proxyResponse.pipe(res, {
          end: true
        })
      }
    )

    req.pipe(proxyRequest, {
      end: true
    })
  })

  const browserless = await getBrowserContext(t, {
    proxyServer
  })
  const page = await browserless.page()
  t.teardown(() => page.close())

  await browserless.goto(page, {
    url: 'http://example.com'
  })

  t.deepEqual(proxiedRequestUrls, ['http://example.com/', 'http://example.com/favicon.ico'])
})

test('ensure to destroy browser contexts', async t => {
  const browserlessFactory = createBrowser()
  t.teardown(browserlessFactory.close)

  const browser = await browserlessFactory.browser()

  t.is(browser.browserContexts().length, 1)

  const browserless = await browserlessFactory.createContext()

  await browserless.context()

  t.is(browser.browserContexts().length, 2)

  await browserless.destroyContext()

  t.is(browser.browserContexts().length, 1)
})

test('force to destroy a browser context', async t => {
  const browserlessFactory = createBrowser()
  t.teardown(browserlessFactory.close)

  const browserless = await browserlessFactory.createContext()

  const promise = browserless.html('https://example.com')

  await setTimeout(500)

  await browserless.destroyContext({
    force: true
  })

  const error = await Promise.resolve(promise).catch(error => error)

  t.is(error.name, 'AbortError')
})

test('ensure to close browser', async t => {
  const browser = require('..')()
  await browser.close()
  t.true(browser.isClosed())
})

test("don't respawn after close", async t => {
  const script = path.join(__dirname, '../../../packages/benchmark/src/screenshot/speed.js')
  const { exitCode } = await $(`node ${script}`)
  t.is(exitCode, 0)
})

test('respawn under `Protocol error (Target.createBrowserContext): Target closed`', async t => {
  /**
   * It simulates the browser is dead before created a context
   */
  {
    const browserlessFactory = createBrowser()
    t.teardown(browserlessFactory.close)

    const pid = (await browserlessFactory.browser()).process().pid

    process.kill(pid, 'SIGKILL')
    const browserless = await browserlessFactory.createContext()

    await browserless.text('https://example.com')
    await browserless.destroyContext()

    const anotherPid = (await browserlessFactory.browser()).process().pid

    t.true(pid !== anotherPid)
  }

  /**
   * It simulates the browser is dead after created a context
   */
  {
    const browserlessFactory = createBrowser()
    t.teardown(browserlessFactory.close)

    const pid = (await browserlessFactory.browser()).process().pid

    const browserless = await browserlessFactory.createContext()
    process.kill(pid, 'SIGKILL')

    await browserless.text('https://example.com')
    await browserless.destroyContext()

    const anotherPid = (await browserlessFactory.browser()).process().pid

    t.true(pid !== anotherPid)
  }
})

test('respawn under `Protocol error (Target.createTarget): Target closed`', async t => {
  /**
   * It simulates te context is created but the URL is not set yet
   */
  const browserlessFactory = createBrowser()
  t.teardown(browserlessFactory.close)

  const pid = (await browserlessFactory.browser()).process().pid

  const browserless = await browserlessFactory.createContext()
  await setTimeout(200)
  process.kill(pid, 'SIGKILL')

  await browserless.text('https://example.com')
  await browserless.destroyContext()

  const anotherPid = (await browserlessFactory.browser()).process().pid

  t.true(pid !== anotherPid)
})

test('respawn under `Protocol error (Target.createTarget): Failed to find browser context with id {browserContextId}`', async t => {
  const browserlessFactory = createBrowser()
  t.teardown(browserlessFactory.close)

  const pid = (await browserlessFactory.browser()).process().pid

  const browserless = await browserlessFactory.createContext()
  const contextId = await browserless.context().then(({ id }) => id)

  await browserless.text('https://example.com')
  await browserless.destroyContext()

  await browserless.text('https://example.com')
  const anotherContextId = await browserless.context().then(({ id }) => id)

  const anotherPid = (await browserlessFactory.browser()).process().pid

  t.true(pid === anotherPid)
  t.false(contextId === anotherContextId)
})

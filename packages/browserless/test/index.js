'use strict'

const { createBrowser, getBrowserContext, getBrowser } = require('@browserless/test/util')
const { request, createServer } = require('http')
const { setTimeout } = require('timers/promises')
const execa = require('execa')
const path = require('path')

const test = require('ava')

require('@browserless/test')(getBrowser())

test('pass specific options to a context', async t => {
  const proxiedRequestUrls = []

  const serverUrl = (() => {
    const server = createServer((req, res) => {
      proxiedRequestUrls.push(req.url)

      const proxyRequest = request(
        req.url,
        {
          method: req.method,
          headers: req.headers
        },
        proxyResponse => {
          res.writeHead(proxyResponse.statusCode, proxyResponse.headers)
          proxyResponse.pipe(res, { end: true })
        }
      )

      req.pipe(proxyRequest, { end: true })
    }).listen()

    return `http://[::]:${server.address().port}`
  })()

  const browserless = await getBrowserContext(t, { proxyServer: serverUrl })
  const page = await browserless.page()
  t.teardown(() => page.close())

  await browserless.goto(page, { url: 'http://example.com' })

  t.deepEqual(proxiedRequestUrls, ['http://example.com/'])
})

test('ensure to destroy browser contexts', async t => {
  const browserlessFactory = createBrowser()

  const browser = await browserlessFactory.browser()

  t.is(browser.browserContexts().length, 1)

  const browserless = await browserlessFactory.createContext()

  await browserless.context()

  t.is(browser.browserContexts().length, 2)

  await browserless.destroyContext()

  t.is(browser.browserContexts().length, 1)
})

test('ensure to close browser', async t => {
  const browser = require('..')()
  await browser.close()
  t.true(browser.isClosed())
})

test("don't respawn after close", async t => {
  const script = path.join(__dirname, '../../../packages/benchmark/src/screenshot/speed.js')
  const { exitCode } = await execa.node(script, { stdio: 'inherit' })
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
  await setTimeout(0)
  process.kill(pid, 'SIGKILL')

  await browserless.text('https://example.com')
  await browserless.destroyContext()

  const anotherPid = (await browserlessFactory.browser()).process().pid

  t.true(pid !== anotherPid)
})

test('respawn under `Protocol error (Target.createTarget): browserContextId`', async t => {
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

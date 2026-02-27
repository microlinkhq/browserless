'use strict'

const { setTimeout } = require('timers/promises')
const { request } = require('http')
const $ = require('tinyspawn')
const path = require('path')
const ava = require('ava')

const { runServer, createBrowser, getBrowserContext, getBrowser } = require('@browserless/test')

const test = process.env.CI ? ava.serial : ava

require('@browserless/test/suite')(getBrowser())
test('pass specific options to a context', async t => {
  const proxiedRequestUrls = []

  const proxyUrl = await runServer(t, async ({ req, res }) => {
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

  const url = await runServer(t, ({ res }) => {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end('<html><body><h1>origin server reached</h1></body></html>')
  })

  const browserless = await getBrowserContext(t, {
    proxyServer: proxyUrl.slice(0, -1),
    proxyBypassList: ['<-loopback>']
  })
  const text = await browserless.text(url)

  t.is(text, 'origin server reached')
  t.deepEqual(proxiedRequestUrls, [
    new URL(url).toString(),
    new URL('/favicon.ico', url).toString()
  ])
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

test('withPage timeout cleanup should not emit unhandled rejections', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close

  let pid = 1000

  driver.spawn = () => {
    let clientCalls = 0
    let isClosed = false

    const page = {
      _client: () => {
        clientCalls += 1
        if (clientCalls === 1) return { id: () => 'page-id' }
        throw new Error('client disposed')
      },
      close: () => Promise.resolve().then(() => (isClosed = true)),
      isClosed: () => isClosed
    }

    const browserContext = {
      id: 'ctx-1',
      close: () => Promise.resolve(),
      newPage: () => Promise.resolve(page)
    }

    return Promise.resolve({
      process: () => ({ pid: ++pid }),
      isConnected: () => true,
      once: () => {},
      version: () => Promise.resolve('mock'),
      createBrowserContext: () => Promise.resolve(browserContext),
      close: () => Promise.resolve(),
      disconnect: () => Promise.resolve()
    })
  }

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
  })

  const browser = browserlessFactory({ timeout: 30 })
  t.teardown(browser.close)

  const browserless = await browser.createContext({ retry: 0 })

  let unhandledError
  const onUnhandledRejection = error => {
    unhandledError = error
  }
  process.once('unhandledRejection', onUnhandledRejection)

  const evaluate = browserless.withPage(() => async () => new Promise(() => {}), { timeout: 30 })
  const error = await evaluate().catch(error => error)

  await setTimeout(60)
  process.removeListener('unhandledRejection', onUnhandledRejection)

  t.is(error.code, 'EBRWSRTIMEOUT')
  t.falsy(unhandledError, unhandledError && unhandledError.message)
})

test('withPage clears timeout cleanup timer after success', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  const originalSetTimeout = global.setTimeout
  const originalClearTimeout = global.clearTimeout

  const closePageTimers = new Set()
  const clearedClosePageTimers = new Set()
  let pid = 2000

  global.setTimeout = (fn, timeout, ...args) => {
    const timer = originalSetTimeout(fn, timeout, ...args)
    if (typeof fn === 'function' && fn.toString().includes('closePage(page, name)')) {
      closePageTimers.add(timer)
    }
    return timer
  }

  global.clearTimeout = timer => {
    if (closePageTimers.has(timer)) clearedClosePageTimers.add(timer)
    return originalClearTimeout(timer)
  }

  driver.spawn = () => {
    let isClosed = false

    const page = {
      _client: () => ({ id: () => 'page-id' }),
      close: () => Promise.resolve().then(() => (isClosed = true)),
      isClosed: () => isClosed
    }

    const browserContext = {
      id: 'ctx-2',
      close: () => Promise.resolve(),
      newPage: () => Promise.resolve(page)
    }

    return Promise.resolve({
      process: () => ({ pid: ++pid }),
      isConnected: () => true,
      once: () => {},
      version: () => Promise.resolve('mock'),
      createBrowserContext: () => Promise.resolve(browserContext),
      close: () => Promise.resolve(),
      disconnect: () => Promise.resolve()
    })
  }

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
    global.setTimeout = originalSetTimeout
    global.clearTimeout = originalClearTimeout
  })

  const browser = browserlessFactory({ timeout: 1000 })
  t.teardown(browser.close)

  const browserless = await browser.createContext({ retry: 0 })
  const evaluate = browserless.withPage(() => async () => 'ok', { timeout: 1000 })
  const result = await evaluate()

  t.is(result, 'ok')
  t.true(closePageTimers.size > 0)
  t.true(
    [...closePageTimers].every(timer => clearedClosePageTimers.has(timer)),
    `all cleanup timers should be cleared: created=${closePageTimers.size}, cleared=${clearedClosePageTimers.size}`
  )
})

test('withPage does not retry non-transient errors', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 3000

  driver.spawn = () => {
    let isClosed = false

    const page = {
      _client: () => ({ id: () => 'page-id' }),
      close: () => Promise.resolve().then(() => (isClosed = true)),
      isClosed: () => isClosed
    }

    const browserContext = {
      id: 'ctx-3',
      close: () => Promise.resolve(),
      newPage: () => Promise.resolve(page)
    }

    return Promise.resolve({
      process: () => ({ pid: ++pid }),
      isConnected: () => true,
      once: () => {},
      version: () => Promise.resolve('mock'),
      createBrowserContext: () => Promise.resolve(browserContext),
      close: () => Promise.resolve(),
      disconnect: () => Promise.resolve()
    })
  }

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
  })

  const browser = browserlessFactory({ timeout: 500 })
  t.teardown(browser.close)
  const browserless = await browser.createContext({ retry: 2 })

  let attempts = 0
  const evaluate = browserless.withPage(
    () => async () => {
      attempts += 1
      throw new Error('boom')
    },
    { timeout: 500 }
  )

  const error = await evaluate().catch(error => error)

  t.is(attempts, 1)
  t.is(error.message, 'boom')
})

test('withPage retries transient context disconnections', async t => {
  const browserlessFactory = require('..')
  const { contextDisconnected } = require('@browserless/errors')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 4000

  driver.spawn = () => {
    let isClosed = false

    const page = {
      _client: () => ({ id: () => 'page-id' }),
      close: () => Promise.resolve().then(() => (isClosed = true)),
      isClosed: () => isClosed
    }

    const browserContext = {
      id: `ctx-${pid}`,
      close: () => Promise.resolve(),
      newPage: () => Promise.resolve(page)
    }

    return Promise.resolve({
      process: () => ({ pid: ++pid }),
      isConnected: () => true,
      once: () => {},
      version: () => Promise.resolve('mock'),
      createBrowserContext: () => Promise.resolve(browserContext),
      close: () => Promise.resolve(),
      disconnect: () => Promise.resolve()
    })
  }

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
  })

  const browser = browserlessFactory({ timeout: 3000 })
  t.teardown(browser.close)
  const browserless = await browser.createContext({ retry: 1 })

  let attempts = 0
  const evaluate = browserless.withPage(
    () => async () => {
      attempts += 1
      if (attempts === 1) throw contextDisconnected()
      return 'ok'
    },
    { timeout: 3000 }
  )

  const result = await evaluate()

  t.is(result, 'ok')
  t.is(attempts, 2)
})

test('withPage close does not respawn browser for metadata logging', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 4500
  let spawnCount = 0

  driver.spawn = () => {
    spawnCount += 1
    let isConnected = true
    let isClosed = false

    const page = {
      _client: () => ({ id: () => 'page-id' }),
      close: () => Promise.resolve().then(() => (isClosed = true)),
      isClosed: () => isClosed
    }

    const browserContext = {
      id: `ctx-${pid}`,
      close: () => Promise.resolve(),
      newPage: () => {
        isConnected = false
        return Promise.resolve(page)
      }
    }

    return Promise.resolve({
      process: () => ({ pid: ++pid }),
      isConnected: () => isConnected,
      once: () => {},
      version: () => Promise.resolve('mock'),
      createBrowserContext: () => Promise.resolve(browserContext),
      close: () => Promise.resolve(),
      disconnect: () => Promise.resolve()
    })
  }

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
  })

  const browser = browserlessFactory({ timeout: 500 })
  t.teardown(browser.close)

  const browserless = await browser.createContext({ retry: 0 })
  const evaluate = browserless.withPage(() => async () => 'ok', { timeout: 500 })
  const result = await evaluate()

  t.is(result, 'ok')
  t.is(spawnCount, 1)
})

test('spawn metadata logging does not call browser.version', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close

  let versionCallCount = 0
  let pid = 5000

  driver.spawn = () =>
    Promise.resolve({
      process: () => ({ pid: ++pid }),
      isConnected: () => true,
      once: () => {},
      version: () => {
        versionCallCount += 1
        return Promise.resolve('mock')
      },
      createBrowserContext: () =>
        Promise.resolve({
          id: `ctx-${pid}`,
          close: () => Promise.resolve(),
          newPage: () =>
            Promise.resolve({
              _client: () => ({ id: () => 'page-id' }),
              close: () => Promise.resolve(),
              isClosed: () => false
            })
        }),
      close: () => Promise.resolve(),
      disconnect: () => Promise.resolve()
    })

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
  })

  const browser = browserlessFactory({ timeout: 500 })
  t.teardown(browser.close)

  await browser.browser()
  await setTimeout(0)

  t.is(versionCallCount, 0)
})

test('lock is scoped per browserless instance', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close

  let pid = 1000

  driver.spawn = ({ instance } = {}) =>
    setTimeout(instance === 'slow' ? 500 : 0).then(() => ({
      pid: ++pid,
      close: () => Promise.resolve(),
      isConnected: () => true,
      once: () => {},
      version: () => Promise.resolve('mock')
    }))

  driver.close = subprocess => Promise.resolve(subprocess.close && subprocess.close())

  t.teardown(() => {
    driver.spawn = originalSpawn
    driver.close = originalClose
  })

  const slow = browserlessFactory({ instance: 'slow' })
  const fast = browserlessFactory({ instance: 'fast' })

  t.teardown(slow.close)
  t.teardown(fast.close)

  const slowBrowser = slow.browser()

  await setTimeout(50)

  const startedAt = Date.now()
  await fast.browser()
  const elapsed = Date.now() - startedAt

  await slowBrowser

  t.true(elapsed < 150, `fast instance was blocked for ${elapsed}ms`)
})

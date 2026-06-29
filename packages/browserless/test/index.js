'use strict'

const { setTimeout } = require('timers/promises')
const { request } = require('http')
const $ = require('tinyspawn')
const path = require('path')
const ava = require('ava')

const { runServer, createBrowser, getBrowserContext, getBrowser } = require('@browserless/test')
const { detectBuild, parseGalliumVersion } = require('../src/report')

const test = process.env.CI ? ava.serial : ava

test('detectBuild distinguishes testing builds from branded Chrome', t => {
  // Chrome for Testing (puppeteer cache) -> 'chrome-for-testing'
  t.is(
    detectBuild('/root/.cache/chrome/linux-150.0.7871.24/chrome-linux64/chrome'),
    'chrome-for-testing'
  )
  t.is(
    detectBuild(
      '/Users/x/.cache/puppeteer/chrome/mac_arm-150/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
    ),
    'chrome-for-testing'
  )
  t.is(
    detectBuild('C:\\Users\\x\\.cache\\chrome\\win64-150\\chrome-win64\\chrome.exe'),
    'chrome-for-testing'
  )
  // chrome-headless-shell / Chromium
  t.is(
    detectBuild('/root/.cache/chrome-headless-shell/linux-150/chrome-headless-shell'),
    'chrome-headless-shell'
  )
  t.is(detectBuild('/usr/lib/chromium/chromium'), 'Chromium')
  // Branded Google Chrome must NOT be misreported as a testing build.
  t.is(detectBuild('/opt/google/chrome/chrome'), null)
  t.is(detectBuild('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'), null)
  t.is(detectBuild('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'), null)
  t.is(detectBuild('/usr/bin/google-chrome-stable'), null)
})

test('parseGalliumVersion reads the loaded Mesa version from the .so filename', t => {
  // Source-built Mesa side-loaded over the distro package: the version comes from
  // the actual driver, NOT dpkg (which would report the stale apt package).
  t.is(
    parseGalliumVersion(['libGLX_mesa.so.0', 'libgallium-26.1.3.so', 'libEGL_mesa.so.0']),
    '26.1.3'
  )
  // Two-component versions are valid too.
  t.is(parseGalliumVersion(['libgallium-25.0.so']), '25.0')
  // No versioned gallium driver present -> null (caller falls back to dpkg).
  t.is(parseGalliumVersion(['libgallium.so', 'libGLX_mesa.so.0']), null)
  t.is(parseGalliumVersion([]), null)
})

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

test('report() returns browser, GPU backend and host CPU', async t => {
  const browserless = await getBrowserContext(t)
  const { browser, environment, os, gpu, cpu, memory } = await browserless.report()

  t.is(typeof browser.name, 'string')
  t.is(typeof browser.headless, 'boolean')
  t.true(browser.arguments === undefined || Array.isArray(browser.arguments))
  t.true(browser.customArguments === undefined || Array.isArray(browser.customArguments))

  t.is(typeof environment.virtualized, 'boolean')
  t.is(typeof environment.container, 'boolean')

  t.true(gpu.webgl.v1.supported)
  t.true(gpu.webgl.v2.supported)
  t.is(typeof gpu.graphics.name, 'string') // OpenGL / Vulkan / Metal / Direct3D11
  t.true(['hardware', 'software'].includes(gpu.type))
  t.is(typeof gpu.webgpu.supported, 'boolean')
  // never a silent SwiftShader / 2D fallback (~4x slower on the GPU-less fleet).
  t.false(/swiftshader/i.test(gpu.webgl.v1.unmaskedRenderer), gpu.webgl.v1.unmaskedRenderer)
  t.true(Array.isArray(gpu.webgl.v1.extensions))
  t.true(gpu.webgl.v1.capabilities.maxTextureSize > 0)
  // --use-angle=gl resolves to Mesa llvmpipe on the GPU-less Linux target (CI
  // under Xvfb); native GL elsewhere, so pin the software path only on CI.
  if (process.env.CI) {
    t.is(gpu.vendor, 'Mesa', gpu.webgl.v1.unmaskedRenderer)
    t.is(gpu.device, 'llvmpipe', gpu.webgl.v1.unmaskedRenderer)
    t.is(gpu.type, 'software')
    t.is(gpu.graphics.translationLayer, 'ANGLE')
    t.is(gpu.graphics.name, 'OpenGL')
  }

  t.is(typeof os.platform, 'string')
  t.is(typeof os.release, 'string')
  t.true(cpu.cores > 0)
  t.true(cpu.threads > 0)
  t.is(typeof cpu.model, 'string')
  if (process.platform === 'linux') t.true(Array.isArray(cpu.flags))
  t.true(memory.total > 0)
})

test('report({ benchmark: true }) includes a WebGL performance benchmark', async t => {
  const browserless = await getBrowserContext(t)
  const { performance } = await browserless.report({ benchmark: true })

  t.truthy(performance)
  t.true(performance.webgl.frames > 0)
  t.true(performance.webgl.totalMs > 0)
  t.true(performance.webgl.fps > 0)
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
      connected: true,
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
      connected: true,
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
      connected: true,
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
      connected: true,
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

test('withPage retries transient protocol errors', async t => {
  const browserlessFactory = require('..')
  const { protocolError } = require('@browserless/errors')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 4050

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
      connected: true,
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
      if (attempts === 1) throw protocolError({ message: 'Target closed' })
      return 'ok'
    },
    { timeout: 3000 }
  )

  const result = await evaluate()

  t.is(result, 'ok')
  t.is(attempts, 2)
})

test('withPage retries on "Session closed" error', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 4100

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
      connected: true,
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
      if (attempts === 1) throw new Error('Session closed. Most likely the page has been closed.')
      return 'recovered'
    },
    { timeout: 3000 }
  )

  const result = await evaluate()

  t.is(result, 'recovered')
  t.is(attempts, 2)
})

test('withPage retries on "Attempted to use detached Frame" error', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 4200

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
      connected: true,
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
      if (attempts === 1) {
        throw new Error("Attempted to use detached Frame 'BF1FB34FC20107D5D21C354065F61277'.")
      }
      return 'recovered'
    },
    { timeout: 3000 }
  )

  const result = await evaluate()

  t.is(result, 'recovered')
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
      get connected () {
        return isConnected
      },
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

test('withPage create does not respawn browser for metadata logging', async t => {
  const browserlessFactory = require('..')
  const { driver } = browserlessFactory

  const originalSpawn = driver.spawn
  const originalClose = driver.close
  let pid = 5000
  let spawnCount = 0
  let isConnected = true

  driver.spawn = () => {
    spawnCount += 1
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
      get connected () {
        return isConnected
      },
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
  await browserless.context()

  isConnected = false
  const evaluate = browserless.withPage(() => async () => 'ok', { timeout: 500 })
  const result = await evaluate()

  t.is(result, 'ok')
  t.is(spawnCount, 1)
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
      connected: true,
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

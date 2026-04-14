'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const test = require('ava')

const { runServer, getBrowserContext } = require('@browserless/test')

const getUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>hello</h1></body></html>')
  })

test('adblock assets are lazy loaded at require time', t => {
  const adblockPath = path.resolve(__dirname, '../../../src/adblock.js')
  const script = `
    const fs = require('fs')
    const path = require('path')
    const targetFiles = new Set(['engine.bin', 'autoconsent.playwright.js', 'compact-rules.json'])
    let targetedSyncReads = 0
    const originalReadFileSync = fs.readFileSync
    fs.readFileSync = (...args) => {
      const filePath = typeof args[0] === 'string' ? args[0] : String(args[0])
      if (targetFiles.has(path.basename(filePath))) targetedSyncReads += 1
      return originalReadFileSync(...args)
    }
    require(${JSON.stringify(adblockPath)})
    process.stdout.write(String(targetedSyncReads))
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.is(stdout.trim(), '0')
})

test('pre-warm rules failure does not crash the process', t => {
  const adblockPath = path.resolve(__dirname, '../../../src/adblock.js')
  const script = `
    const fsp = require('fs/promises')
    const origReadFile = fsp.readFile
    fsp.readFile = (...args) => {
      const filePath = typeof args[0] === 'string' ? args[0] : String(args[0])
      if (filePath.includes('compact-rules.json')) {
        return Promise.reject(new Error('simulated ENOENT'))
      }
      return origReadFile(...args)
    }
    const adblock = require(${JSON.stringify(adblockPath)})
    const run = async ({ fn }) => ({ value: await fn.catch(() => {}) })
    adblock.enableBlockingInPage({ exposeFunction: async () => {}, evaluateOnNewDocument: async () => {} }, run, 5000)
    setTimeout(() => { process.stdout.write('ok'); process.exit(0) }, 500)
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8',
    timeout: 5000
  })

  t.is(status, 0, `process crashed: ${stderr}`)
  t.is(stdout.trim(), 'ok')
})

test('setup autoconsent when `adblock` is enabled', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const calls = []
    const originalExposeFunction = page.exposeFunction.bind(page)

    page.exposeFunction = (...args) => {
      calls.push(args[0])
      return originalExposeFunction(...args)
    }

    await goto(page, { url })
    return calls
  })

  const calls = await run()

  t.true(calls.includes('autoconsentSendMessage'))
})

test('skip autoconsent setup when `adblock` is false', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const calls = []
    const originalExposeFunction = page.exposeFunction.bind(page)

    page.exposeFunction = (...args) => {
      calls.push(args[0])
      return originalExposeFunction(...args)
    }

    await goto(page, { url, adblock: false })
    return calls
  })

  const calls = await run()

  t.false(calls.includes('autoconsentSendMessage'))
})

test('initResp includes rules', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return page.evaluate(() => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'initResp') {
            clearTimeout(timeout)
            resolve({
              hasRules: !!msg.rules,
              hasR: !!(msg.rules && msg.rules.r),
              hasIndex: !!(msg.rules && msg.rules.index)
            })
          }
        }
        window.autoconsentSendMessage({ type: 'init' }).catch(() => {})
      })
    })
  })

  const received = await run()
  t.truthy(received, 'initResp should be received')
  t.true(received.hasRules, 'initResp must include rules')
  t.true(received.hasR, 'compact rules must contain r (rules) field')
  t.true(received.hasIndex, 'compact rules must contain index field')
})

test('initResp includes config with expected shape', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return page.evaluate(() => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'initResp') {
            clearTimeout(timeout)
            resolve({ config: msg.config })
          }
        }
        window.autoconsentSendMessage({ type: 'init' }).catch(() => {})
      })
    })
  })

  const received = await run()
  t.truthy(received, 'initResp should be received')
  t.truthy(received.config, 'initResp must include config')
  t.is(received.config.enabled, true)
  t.is(received.config.autoAction, 'optOut')
  t.is(received.config.enablePrehide, true)
  t.is(received.config.isMainWorld, false)
  t.is(typeof received.config.detectRetries, 'number')
  t.truthy(received.config.logs, 'config must include logs')
})

test('eval that succeeds returns the actual result', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return page.evaluate(() => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-ok') {
            clearTimeout(timeout)
            resolve(msg)
          }
        }
        window
          .autoconsentSendMessage({
            type: 'eval',
            id: 'test-ok',
            code: '1 + 1 === 2'
          })
          .catch(() => {})
      })
    })
  })

  const received = await run()
  t.truthy(received, 'evalResp should be received')
  t.is(received.type, 'evalResp')
  t.is(received.id, 'test-ok')
  t.is(received.result, true)
})

test('invalid messages are silently ignored', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    const results = await page.evaluate(() => {
      return Promise.allSettled([
        window.autoconsentSendMessage(null),
        window.autoconsentSendMessage('string'),
        window.autoconsentSendMessage(42)
      ])
    })

    return results.every(r => r.status === 'fulfilled')
  })

  t.true(await run(), 'invalid messages must not throw')
})

test('autoconsent eval that throws still sends evalResp with result false', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return page.evaluate(() => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-throw') {
            clearTimeout(timeout)
            resolve(msg)
          }
        }
        window
          .autoconsentSendMessage({
            type: 'eval',
            id: 'test-throw',
            code: '(() => { throw new Error("boom") })()'
          })
          .catch(() => {})
      })
    })
  })

  const received = await run()
  t.truthy(received, 'evalResp should be received even when eval code throws')
  t.is(received.type, 'evalResp')
  t.is(received.id, 'test-throw')
  t.is(received.result, false)
})

test('autoconsent eval that hangs is timed out', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return page.evaluate(() => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 10000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-hang') {
            clearTimeout(timeout)
            resolve(msg)
          }
        }
        window
          .autoconsentSendMessage({
            type: 'eval',
            id: 'test-hang',
            code: 'new Promise(() => {})'
          })
          .catch(() => {})
      })
    })
  })

  const received = await run()
  t.truthy(received, 'evalResp should be received even when eval code hangs')
  t.is(received.type, 'evalResp')
  t.is(received.id, 'test-hang')
  t.is(received.result, false)
})

test('eval triggered from child frame is rejected', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ req, res }) => {
    res.setHeader('content-type', 'text/html')
    if (req.url === '/frame') {
      return res.end('<html><body></body></html>')
    }
    res.end('<html><body><iframe src="/frame"></iframe></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load' })

    const iframeEl = await page.waitForSelector('iframe')
    const iframe = await iframeEl.contentFrame()

    await page.evaluate(() => {
      window.__iframeEval = false
    })

    const hasBinding = await iframe
      .evaluate(() => typeof window.autoconsentSendMessage === 'function')
      .catch(() => false)

    if (!hasBinding) return false

    await iframe.evaluate(() => {
      window
        .autoconsentSendMessage({
          type: 'eval',
          id: 'frame-eval',
          code: 'window.__iframeEval = true'
        })
        .catch(() => {})
    })

    await new Promise(resolve => setTimeout(resolve, 1000))
    return page.evaluate(() => window.__iframeEval)
  })

  const result = await run()
  t.is(result, false, 'eval from child frame must not execute in main frame')
})

test('`disableAdblock` removes blocker listeners and keeps request interception enabled', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const interceptionCalls = []
    const originalSetRequestInterception = page.setRequestInterception.bind(page)
    page.setRequestInterception = enabled => {
      interceptionCalls.push(enabled)
      return originalSetRequestInterception(enabled)
    }

    await goto(page, { url, adblock: true })

    const listenersBeforeDisable = {
      request: page.listenerCount('request'),
      frameattached: page.listenerCount('frameattached'),
      domcontentloaded: page.listenerCount('domcontentloaded')
    }

    await page.disableAdblock()
    const listenersAfterDisable = {
      request: page.listenerCount('request'),
      frameattached: page.listenerCount('frameattached'),
      domcontentloaded: page.listenerCount('domcontentloaded')
    }
    await page.disableAdblock()

    return { interceptionCalls, listenersBeforeDisable, listenersAfterDisable }
  })

  const { interceptionCalls, listenersBeforeDisable, listenersAfterDisable } = await run()

  t.true(interceptionCalls.includes(true))
  t.false(interceptionCalls.includes(false))

  t.true(listenersAfterDisable.request < listenersBeforeDisable.request)
  t.true(listenersAfterDisable.frameattached <= listenersBeforeDisable.frameattached)
  t.true(listenersAfterDisable.domcontentloaded <= listenersBeforeDisable.domcontentloaded)
})

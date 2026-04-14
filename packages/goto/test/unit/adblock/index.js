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
    const targetFiles = new Set(['engine.bin', 'autoconsent.playwright.js', 'rules.json'])
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
            resolve(msg)
          }
        }
        window.autoconsentSendMessage({ type: 'init' }).catch(() => {})
      })
    })
  })

  const received = await run()
  t.truthy(received, 'initResp should be received')
  t.truthy(received.rules, 'initResp must include rules')
  t.true(Array.isArray(received.rules.autoconsent), 'rules must contain autoconsent array')
  t.true(received.rules.autoconsent.length > 0, 'autoconsent rules must not be empty')
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

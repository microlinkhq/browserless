'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const test = require('ava')

const { PuppeteerBlocker } = require('@ghostery/adblocker-puppeteer')
const { runServer, getBrowserContext } = require('@browserless/test')
const { AUTOCONSENT_WORLD, AUTOCONSENT_BINDING, runAutoConsent } = require('../../../src/adblock')

const TEST_RULES = [
  '###browserless-test-ad',
  '##.browserless-test-ad',
  '||framed-ad.localhost^$subdocument'
]

const { deserialize } = PuppeteerBlocker
PuppeteerBlocker.deserialize = function (...args) {
  const engine = deserialize.apply(this, args)
  engine.updateFromDiff({ added: TEST_RULES })
  return engine
}

const getUrl = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>hello</h1></body></html>')
  })

const getUrlWithFrame = t =>
  runServer(t, ({ req, res }) => {
    res.setHeader('content-type', 'text/html')
    if (req.url === '/frame') return res.end('<html><body></body></html>')
    res.end('<html><body><iframe src="/frame"></iframe></body></html>')
  })

const evaluateInAutoconsentWorld = async (page, fn, frame = page.mainFrame(), args = []) => {
  const client = page._client()
  const { executionContextId } = await client.send('Page.createIsolatedWorld', {
    frameId: frame._id,
    worldName: AUTOCONSENT_WORLD
  })
  const { result, exceptionDetails } = await client.send('Runtime.evaluate', {
    expression: `(${fn})(...${JSON.stringify(args)})`,
    contextId: executionContextId,
    awaitPromise: true,
    returnByValue: true
  })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description)
  return result.value
}

const waitForInitDone = async page => {
  for (let attempts = 0; attempts < 50 && !page._autoconsentInitDone; attempts++) {
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return page._autoconsentInitDone === true
}

const autoconsentGlobals = () =>
  Object.getOwnPropertyNames(window).filter(name => /autoconsent|puppeteer_/i.test(name))

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
    const client = { on: () => {}, off: () => {}, send: async () => ({}) }
    const page = { _client: () => client, mainFrame: () => ({ _id: 'main' }), on: () => {}, off: () => {} }
    adblock.enableBlockingInPage(page, run, 5000)
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
    await goto(page, { url })
    return waitForInitDone(page)
  })

  t.true(await run(), 'autoconsent must complete the init handshake')
})

test('skip autoconsent setup when `adblock` is false', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, adblock: false })
    await new Promise(resolve => setTimeout(resolve, 500))
    return { setup: page._autoconsentSetup, initDone: page._autoconsentInitDone }
  })

  const { setup, initDone } = await run()
  t.falsy(setup)
  t.falsy(initDone)
})

test('autoconsent leaves no globals in the main world of any frame', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrlWithFrame(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load' })
    const initDone = await waitForInitDone(page)
    const iframe = await (await page.waitForSelector('iframe')).contentFrame()
    return {
      initDone,
      mainFrame: await page.evaluate(autoconsentGlobals),
      childFrame: await iframe.evaluate(autoconsentGlobals)
    }
  })

  const { initDone, mainFrame, childFrame } = await run()
  t.true(initDone)
  t.deepEqual(mainFrame, [])
  t.deepEqual(childFrame, [])
})

test('initResp includes rules', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 5000)
        const messages = []
        window.autoconsentReceiveMessage = msg => {
          messages.push(msg && typeof msg === 'object' ? msg.type : String(msg))
          if (msg && msg.type === 'initResp') {
            clearTimeout(timeout)
            resolve({
              msgKeys: Object.keys(msg).sort().join(','),
              hasRules: !!msg.rules,
              hasR: !!(msg.rules && msg.rules.r),
              hasIndex: !!(msg.rules && msg.rules.index),
              configKeys: msg.config ? Object.keys(msg.config).sort().join(',') : 'NO_CONFIG',
              messages: messages.join(';')
            })
          }
        }
        window.autoconsentSendMessage({ type: 'init' })
      })
    })
  })

  const received = await run()
  t.truthy(received, 'initResp should be received')
  t.not(received, 'TIMEOUT', 'timed out, no initResp received')
  /* `messages` records autoconsent's internal message ordering, which is
     timing-dependent and shifts across dependency bumps; keep it in the
     failure diagnostics below but out of the snapshot */
  const { messages, ...snapshot } = received
  t.snapshot(snapshot, 'diagnostic snapshot of initResp')
  t.true(
    received.hasRules,
    `initResp must include rules (keys: ${received.msgKeys}, config: ${received.configKeys}, messages: ${messages})`
  )
  t.true(received.hasR, 'compact rules must contain r (rules) field')
  t.true(received.hasIndex, 'compact rules must contain index field')
})

test('initResp includes config with expected shape', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 5000)
        window.autoconsentReceiveMessage = msg => {
          if (msg && msg.type === 'initResp') {
            clearTimeout(timeout)
            resolve({
              configStr: JSON.stringify(msg.config),
              configKeys: msg.config ? Object.keys(msg.config).sort().join(',') : 'NO_CONFIG',
              msgKeys: Object.keys(msg).sort().join(',')
            })
          }
        }
        window.autoconsentSendMessage({ type: 'init' })
      })
    })
  })

  const received = await run()
  t.truthy(received, 'initResp should be received')
  t.not(received, 'TIMEOUT', 'timed out, no initResp received')
  t.snapshot(received, 'diagnostic snapshot of config')
  const config = JSON.parse(received.configStr)
  t.truthy(config, 'initResp must include config')
  t.is(config.enabled, true)
  t.is(config.autoAction, 'optOut')
  t.is(config.enablePrehide, true)
  t.is(
    config.isMainWorld,
    false,
    `config keys: ${received.configKeys}, msg keys: ${received.msgKeys}`
  )
  t.is(typeof config.detectRetries, 'number')
  t.truthy(config.logs, 'config must include logs')
  t.is(config.enableHeuristicDetection, true)
  t.is(config.heuristicMode, 'tier2')
  t.is(config.enablePopupMutationObserver, true)
})

test('runAutoConsent fallback initializes autoconsent when injection did not run', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    /* simulate a document where the new-document injection never ran */
    const client = page._client()
    const send = client.send.bind(client)
    client.send = (method, params, ...rest) =>
      method === 'Page.addScriptToEvaluateOnNewDocument' && params?.worldName === AUTOCONSENT_WORLD
        ? Promise.resolve({ identifier: '' })
        : send(method, params, ...rest)

    await goto(page, { url })
    return waitForInitDone(page)
  })

  t.true(await run(), 'fallback injection must complete the init handshake')
})

test('runAutoConsent fallback reuses the running autoconsent instance', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const client = page._client()
    const initContextIds = []
    const fallbackContextIds = []

    client.on('Runtime.bindingCalled', ({ payload, executionContextId }) => {
      if (payload.includes('"type":"init"')) initContextIds.push(executionContextId)
    })

    const send = client.send.bind(client)
    client.send = async (method, params, ...rest) => {
      const result = await send(method, params, ...rest)
      if (method === 'Page.createIsolatedWorld' && params?.worldName === AUTOCONSENT_WORLD) {
        fallbackContextIds.push(result.executionContextId)
      }
      return result
    }

    await goto(page, { url })
    await waitForInitDone(page)

    page._autoconsentInitDone = false
    await runAutoConsent(page)
    await new Promise(resolve => setTimeout(resolve, 500))
    return { initContextIds, fallbackContextIds }
  })

  const { initContextIds, fallbackContextIds } = await run()
  t.is(initContextIds.length, 1, 'a second injection must not start another autoconsent instance')
  t.deepEqual(
    fallbackContextIds.slice(-1),
    initContextIds,
    'the fallback must evaluate in the world that already runs autoconsent'
  )
})

const spyAdblockListeners = client => {
  const added = []
  const removed = new Set()
  const on = client.on.bind(client)
  const off = client.off.bind(client)
  client.on = (event, handler) => {
    if (new Error().stack.includes('/src/adblock.js')) added.push(handler)
    return on(event, handler)
  }
  client.off = (event, handler) => {
    removed.add(handler)
    return off(event, handler)
  }
  return { added, removed }
}

test('concurrent goto calls on the same page set up autoconsent once', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const { added } = spyAdblockListeners(page._client())
    await Promise.all([goto(page, { url: `${url}1` }), goto(page, { url: `${url}2` })])
    return added.length
  })

  t.is(await run(), 3, 'one listener per CDP event, registered once')
})

test('autoconsent session listeners are removed when the page closes', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    const { added, removed } = spyAdblockListeners(page._client())
    await goto(page, { url })
    await page.close()
    return { added: added.length, detached: added.filter(handler => removed.has(handler)).length }
  })

  const { added, detached } = await run()
  t.is(added, 3)
  t.is(detached, 3)
})

test('autoconsent tracks only the contexts of the current document', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    for (const path of ['one', 'two', 'three']) await goto(page, { url: `${url}${path}` })
    await waitForInitDone(page)
    return page._autoconsentContextIds.size
  })

  t.is(await run(), 1)
})

test('autoconsent ignores messages from other worlds even when the binding reaches them', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await waitForInitDone(page)
    await page._client().send('Runtime.addBinding', { name: AUTOCONSENT_BINDING })
    await page.evaluate(binding => {
      window.__forged = false
      window[binding](
        JSON.stringify({ type: 'eval', id: 'forged', code: 'window.__forged = true' })
      )
    }, AUTOCONSENT_BINDING)
    await new Promise(resolve => setTimeout(resolve, 1000))
    return page.evaluate(() => window.__forged)
  })

  t.false(await run(), 'main-world messages must not reach the autoconsent handler')
})

test('autoconsent keeps messaging after a back/forward cache restore', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(
      "<html><head><script>window.__persisted = []; addEventListener('pageshow', event => window.__persisted.push(event.persisted))</script></head><body><h1>hello</h1></body></html>"
    )
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await goto(page, { url: url.replace('127.0.0.1', 'localhost') })
    await page.goBack({ waitUntil: 'load' })
    await waitForInitDone(page)
    const restoredFromCache = await page.evaluate(() => window.__persisted.includes(true))

    const reply = await evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve('NO_REPLY'), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'bfcache') {
            clearTimeout(timeout)
            resolve(msg.result)
          }
        }
        try {
          window.autoconsentSendMessage({ type: 'eval', id: 'bfcache', code: '40 + 2' })
        } catch (error) {
          clearTimeout(timeout)
          resolve(`THREW ${error.message}`)
        }
      })
    })

    return { restoredFromCache, reply }
  })

  const { restoredFromCache, reply } = await run()
  t.true(restoredFromCache, 'the page must be restored from the back/forward cache')
  t.is(reply, 42)
})

const consentBanner = buttons => `<html><body>
  <h1>hello</h1>
  <div id="consent-fixture" style="position:fixed;bottom:0;left:0;right:0;background:#fff;padding:16px;z-index:9999">
    <p>We use cookies on this website to improve your experience.</p>
    ${buttons}
  </div>
</body></html>`

/* poll from Node: in-page timers/rAF can be throttled for background pages */
const waitForClicked = async page => {
  for (let attempts = 0; attempts < 150; attempts++) {
    const clicked = await page.evaluate(() => window.__clicked || false).catch(() => false)
    if (clicked) return clicked
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

test('heuristic dismisses a consent banner with only an acknowledge button', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(
      consentBanner(
        "<button onclick=\"window.__clicked='acknowledge';document.getElementById('consent-fixture').remove()\">Got it</button>"
      )
    )
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitForClicked(page)
  })

  t.is(await run(), 'acknowledge', 'tier1 heuristic must click the acknowledge button')
})

test('heuristic prefers the reject button over acknowledge', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(
      consentBanner(
        "<button onclick=\"window.__clicked='reject';document.getElementById('consent-fixture').remove()\">Reject all</button>" +
          "<button onclick=\"window.__clicked='acknowledge';document.getElementById('consent-fixture').remove()\">Got it</button>"
      )
    )
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    return waitForClicked(page)
  })

  t.is(await run(), 'reject', 'reject must win over acknowledge')
})

test('eval that succeeds returns the actual result', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-ok') {
            clearTimeout(timeout)
            resolve(msg)
          }
        }
        window.autoconsentSendMessage({ type: 'eval', id: 'test-ok', code: '1 + 1 === 2' })
      })
    })
  })

  const received = await run()
  t.truthy(received, 'evalResp should be received')
  t.is(received.type, 'evalResp')
  t.is(received.id, 'test-ok')
  t.is(received.result, true)
})

test('eval snippets run in the main world', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    await page.evaluate(() => {
      window.__pageGlobal = 'visible'
    })

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-main-world') {
            clearTimeout(timeout)
            resolve(msg.result)
          }
        }
        window.autoconsentSendMessage({
          type: 'eval',
          id: 'test-main-world',
          code: 'window.__pageGlobal'
        })
      })
    })
  })

  t.is(await run(), 'visible')
})

test('invalid messages are silently ignored', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve('TIMEOUT'), 5000)
        window.autoconsentReceiveMessage = msg => {
          if (msg && msg.type === 'initResp') {
            clearTimeout(timeout)
            resolve('initResp')
          }
        }
        window.autoconsentSendMessage(null)
        window.autoconsentSendMessage('string')
        window.autoconsentSendMessage(42)
        window.autoconsentSendMessage({ type: 'init' })
      })
    })
  })

  t.is(await run(), 'initResp', 'invalid messages must not break later messages')
})

test('autoconsent eval that throws still sends evalResp with result false', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 3000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-throw') {
            clearTimeout(timeout)
            resolve(msg)
          }
        }
        window.autoconsentSendMessage({
          type: 'eval',
          id: 'test-throw',
          code: '(() => { throw new Error("boom") })()'
        })
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

    return evaluateInAutoconsentWorld(page, () => {
      return new Promise(resolve => {
        const timeout = setTimeout(() => resolve(null), 10000)
        window.autoconsentReceiveMessage = msg => {
          if (msg.type === 'evalResp' && msg.id === 'test-hang') {
            clearTimeout(timeout)
            resolve(msg)
          }
        }
        window.autoconsentSendMessage({
          type: 'eval',
          id: 'test-hang',
          code: 'new Promise(() => {})'
        })
      })
    })
  })

  const received = await run()
  t.truthy(received, 'evalResp should be received even when eval code hangs')
  t.is(received.type, 'evalResp')
  t.is(received.id, 'test-hang')
  t.is(received.result, false)
})

test('autoconsent does not run in child frames and ignores their messages', async t => {
  const browserless = await getBrowserContext(t)
  const url = await getUrlWithFrame(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load' })
    await waitForInitDone(page)

    const iframe = await (await page.waitForSelector('iframe')).contentFrame()
    await page.evaluate(() => {
      window.__iframeEval = false
    })

    const childWorld = await evaluateInAutoconsentWorld(
      page,
      binding => {
        const initialized = typeof window.autoconsentReceiveMessage === 'function'
        window[binding](
          JSON.stringify({ type: 'eval', id: 'frame-eval', code: 'window.__iframeEval = true' })
        )
        return initialized
      },
      iframe,
      [AUTOCONSENT_BINDING]
    )

    await new Promise(resolve => setTimeout(resolve, 1000))
    return { childWorld, iframeEval: await page.evaluate(() => window.__iframeEval) }
  })

  const { childWorld, iframeEval } = await run()
  t.false(childWorld, 'autoconsent must not initialize in child frames')
  t.false(iframeEval, 'eval from child frame must not execute in main frame')
})

const GHOSTERY_DOM_SELECTORS = [
  '[id]:not(html):not(body),[class]:not(html):not(body),[href]:not(html):not(body)',
  'iframe[src],iframe[href]'
]

const cosmeticFixture = port => `<html><head><script>
  window.__foreignCalls = []
  const record = (api, detail) => {
    const frames = (new Error().stack || '').split('\\n').slice(3)
    if (!frames.some(frame => frame.includes(location.origin))) {
      window.__foreignCalls.push({ api, detail: String(detail), stack: frames.join('\\n') })
    }
  }
  const hookMethod = (proto, name) => {
    const original = proto[name]
    proto[name] = function (detail) {
      record(name, detail)
      return original.apply(this, arguments)
    }
  }
  const hookGetter = (proto, name) => {
    const descriptor = Object.getOwnPropertyDescriptor(proto, name)
    Object.defineProperty(proto, name, {
      ...descriptor,
      get () {
        record(name, '')
        return descriptor.get.call(this)
      }
    })
  }
  hookMethod(Document.prototype, 'querySelectorAll')
  hookMethod(Element.prototype, 'querySelectorAll')
  hookMethod(Element.prototype, 'getAttribute')
  hookGetter(Element.prototype, 'classList')
  hookGetter(Node.prototype, 'nodeName')
  hookGetter(Document.prototype, 'documentElement')
</script></head><body>
  <div id="content-box">content</div>
  <div id="browserless-test-ad">ad banner</div>
  <div class="browserless-test-ad">ad slot</div>
  <a href="/somewhere">link</a>
  <iframe id="ad-frame" src="http://framed-ad.localhost:${port}/frame"></iframe>
</body></html>`

const getCosmeticUrl = async t => {
  const frameRequests = []
  const url = new URL(
    await runServer(t, ({ req, res }) => {
      res.setHeader('content-type', 'text/html')
      if (req.url === '/frame') {
        frameRequests.push(req.headers.host)
        return res.end('<html><body>framed ad</body></html>')
      }
      res.end(cosmeticFixture(req.headers.host.split(':')[1]))
    })
  )
  url.hostname = 'ghostery.localhost'
  return { url: url.toString(), frameRequests }
}

const isGhosteryScan = ({ api, detail, stack }) =>
  stack.includes('extractFeaturesFromDOM') ||
  (api === 'querySelectorAll' && GHOSTERY_DOM_SELECTORS.includes(detail))

const waitForHidden = async (page, id) => {
  for (let attempts = 0; attempts < 100; attempts++) {
    const hidden = await page
      .evaluate(id => window.getComputedStyle(document.getElementById(id)).display === 'none', id)
      .catch(() => false)
    if (hidden) return true
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  return false
}

test('cosmetic filters from DOM features still hide elements and remove blocked iframes', async t => {
  const browserless = await getBrowserContext(t)
  const { url, frameRequests } = await getCosmeticUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    const adBannerHidden = await waitForHidden(page, 'browserless-test-ad')
    return page.evaluate(
      adBannerHidden => ({
        adBannerHidden,
        adSlotHidden:
          window.getComputedStyle(document.getElementsByClassName('browserless-test-ad')[0])
            .display === 'none',
        contentHidden:
          window.getComputedStyle(document.getElementById('content-box')).display === 'none',
        adFramePresent: !!document.getElementById('ad-frame')
      }),
      adBannerHidden
    )
  })

  const result = await run()

  t.true(frameRequests.length > 0, 'the blocked iframe must have started loading locally')
  t.true(frameRequests.every(host => host.startsWith('framed-ad.localhost:')))
  t.deepEqual(result, {
    adBannerHidden: true,
    adSlotHidden: true,
    contentHidden: false,
    adFramePresent: false
  })
})

test('ghostery DOM scans do not run in the page main world', async t => {
  const browserless = await getBrowserContext(t)
  const { url } = await getCosmeticUrl(t)

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url })
    const adBannerHidden = await waitForHidden(page, 'browserless-test-ad')
    const foreignCalls = await page.evaluate(() => window.__foreignCalls)
    return { adBannerHidden, foreignCalls }
  })

  const { adBannerHidden, foreignCalls } = await run()

  t.true(adBannerHidden, 'DOM features must have been scanned')
  t.deepEqual(
    [...new Set(foreignCalls.filter(isGhosteryScan).map(({ api, detail }) => `${api} ${detail}`))],
    []
  )
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

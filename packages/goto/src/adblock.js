'use strict'

const { PuppeteerBlocker } = require('@ghostery/adblocker-puppeteer')
const pTimeout = require('p-timeout')
const fs = require('fs/promises')
const path = require('path')

const debug = require('debug-logfmt')('browserless:goto:adblock')

const lazy = fn => {
  let p
  return () => (p ??= fn())
}

const autoconsentDir = path.dirname(require.resolve('@duckduckgo/autoconsent'))

const withIsolatedEvaluate = frame =>
  new Proxy(frame, {
    get: (target, property) => {
      if (property === 'evaluate') return (...args) => target.isolatedRealm().evaluate(...args)
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })

const getEngine = lazy(() =>
  fs.readFile(path.resolve(__dirname, './engine.bin')).then(buffer => {
    const engine = PuppeteerBlocker.deserialize(new Uint8Array(buffer))
    const { onFrameNavigated } = engine
    engine.onFrameNavigated = frame => onFrameNavigated(withIsolatedEvaluate(frame))
    engine.on('request-blocked', ({ url }) => debug('block', url))
    engine.on('request-redirected', ({ url }) => debug('redirect', url))
    return engine
  })
)

/**
 * autoconsent.playwright.js is the only browser-injectable IIFE bundle in the package.
 * It is not in the package's "exports" map, so pin @duckduckgo/autoconsent with ~ to
 * avoid breakage from internal restructuring on minor/patch bumps.
 */
const getAutoconsentPlaywrightScript = lazy(() =>
  fs.readFile(path.resolve(autoconsentDir, 'autoconsent.playwright.js'), 'utf8')
)

const getAutoconsentRules = lazy(() =>
  fs.readFile(path.resolve(autoconsentDir, '../rules/compact-rules.json'), 'utf8').then(JSON.parse)
)

/* Configuration passed to autoconsent's `initResp` message.
   See https://github.com/duckduckgo/autoconsent/blob/main/docs/api.md */
const autoconsentConfig = Object.freeze({
  /* activate consent rule matching */
  enabled: true,
  /* automatically reject (opt-out) all cookies */
  autoAction: 'optOut',
  /* skip these CMPs even if detected */
  disabledCmps: [],
  /* hide banners early via CSS before detection finishes */
  enablePrehide: true,
  /* apply CSS-only rules that hide popups lacking a reject button */
  enableCosmeticRules: true,
  /* enable rules auto-generated from common CMP patterns */
  enableGeneratedRules: true,
  /* detect CMPs using heuristics when no specific rule matches */
  enableHeuristicDetection: true,
  /* heuristic popup handling when no specific rule matches:
     click reject if present, else acknowledge (ok/got it), else a lone accept */
  heuristicMode: 'tier2',
  /* also wait on DOM mutations (not just polling) to catch late-mounted popups */
  enablePopupMutationObserver: true,
  /* run in the page's main world (false = isolated world) */
  isMainWorld: false,
  /* max ms to keep prehide CSS applied before removing it */
  prehideTimeout: 2000,
  /* how many times to retry CMP detection (~50 ms apart) */
  detectRetries: 20,
  logs: {
    /* CMP detection / opt-out lifecycle events */
    lifecycle: false,
    /* individual rule step execution */
    rulesteps: false,
    /* CMP detection step details */
    detectionsteps: false,
    /* eval snippet calls */
    evals: false,
    /* rule errors */
    errors: false,
    /* background ↔ content-script messages */
    messages: false,
    /* wait/delay step timing */
    waits: false
  }
})

const AUTOCONSENT_WORLD = 'browserless_autoconsent'
const AUTOCONSENT_BINDING = 'browserlessAutoconsentBinding'

const RECEIVE_MESSAGE = `function (message) {
  return window.autoconsentReceiveMessage && window.autoconsentReceiveMessage(message)
}`

/* Top frame only. autoconsent sends objects through `autoconsentSendMessage`,
   while the CDP binding takes a string under its own name: Chrome re-installs
   bindings on a back/forward cache restore, which must not replace the wrapper. */
const toContentScript = autoconsentScript => `if (window.self === window.top) {
  window.autoconsentSendMessage = message => window.${AUTOCONSENT_BINDING}(JSON.stringify(message))
  ${autoconsentScript}
}`

const parseMessage = payload => {
  try {
    const message = JSON.parse(payload)
    return message && typeof message === 'object' ? message : undefined
  } catch {}
}

const sendMessage = (client, executionContextId, message) =>
  client
    .send('Runtime.callFunctionOn', {
      functionDeclaration: RECEIVE_MESSAGE,
      executionContextId,
      arguments: [{ value: message }],
      awaitPromise: true,
      returnByValue: true
    })
    .catch(() => {})

const onMessage = async ({ page, client, executionContextId, message, timeout }) => {
  switch (message.type) {
    case 'init': {
      page._autoconsentInitDone = true
      const rules = await getAutoconsentRules()
      return sendMessage(client, executionContextId, {
        type: 'initResp',
        config: autoconsentConfig,
        rules
      })
    }

    case 'eval': {
      let result = false
      try {
        result = await pTimeout(page.evaluate(message.code), timeout)
      } catch {}
      return sendMessage(client, executionContextId, { type: 'evalResp', id: message.id, result })
    }

    case 'cmpDetected':
    case 'popupFound':
    case 'autoconsentDone':
      debug(message.type, { cmp: message.cmp })
      break

    case 'optOutResult':
      debug(message.type, { result: message.result })
      break

    case 'autoconsentError':
      debug(message.type, { details: message.details })
      break
  }
}

const listenUntilClose = (page, client, listeners) => {
  const detach = () => {
    page.off('close', detach)
    for (const [event, handler] of listeners) client.off(event, handler)
  }
  for (const [event, handler] of listeners) client.on(event, handler)
  page.on('close', detach)
  return detach
}

const createAutoConsent = async (page, timeout) => {
  const client = page._client()
  const topFrameContexts = (page._autoconsentContextIds = new Set())

  const detach = listenUntilClose(page, client, [
    [
      'Runtime.executionContextCreated',
      ({ context }) => {
        if (context.name !== AUTOCONSENT_WORLD) return
        if (context.auxData?.frameId === page.mainFrame()._id) topFrameContexts.add(context.id)
      }
    ],
    ['Runtime.executionContextsCleared', () => topFrameContexts.clear()],
    [
      'Runtime.bindingCalled',
      ({ name, payload, executionContextId }) => {
        if (name !== AUTOCONSENT_BINDING || !topFrameContexts.has(executionContextId)) return
        const message = parseMessage(payload)
        if (message) onMessage({ page, client, executionContextId, message, timeout })
      }
    ]
  ])

  try {
    const contentScript = toContentScript(await getAutoconsentPlaywrightScript())
    await Promise.all([
      client.send('Runtime.addBinding', {
        name: AUTOCONSENT_BINDING,
        executionContextName: AUTOCONSENT_WORLD
      }),
      client.send('Page.addScriptToEvaluateOnNewDocument', {
        source: contentScript,
        worldName: AUTOCONSENT_WORLD
      })
    ])
    page._autoconsentScript = contentScript
  } catch (error) {
    detach()
    throw error
  }
}

const setupAutoConsent = (page, timeout) =>
  (page._autoconsentSetup ??= createAutoConsent(page, timeout).catch(error => {
    page._autoconsentSetup = undefined
    throw error
  }))

/* Fallback for documents where the new-document injection did not run.
   `Page.createIsolatedWorld` returns the document's existing autoconsent world
   when there is one, where autoconsent's own guard skips a second instance. */
const runAutoConsent = async page => {
  if (page._autoconsentInitDone || !page._autoconsentScript) return
  const client = page._client()
  const { executionContextId } = await client.send('Page.createIsolatedWorld', {
    frameId: page.mainFrame()._id,
    worldName: AUTOCONSENT_WORLD
  })
  return client.send('Runtime.evaluate', {
    expression: page._autoconsentScript,
    contextId: executionContextId
  })
}

const enableBlockingInPage = (page, run, timeout) => {
  getAutoconsentRules().catch(() => {})

  page.disableAdblock = () =>
    getEngine()
      .then(engine => engine.disableBlockingInPage(page, { keepRequestInterception: true }))
      .then(() => debug('disabled'))
      .catch(() => {})

  return [
    run({
      fn: setupAutoConsent(page, timeout),
      timeout,
      debug: 'autoconsent:setup'
    }),
    run({
      fn: getEngine().then(engine => engine.enableBlockingInPage(page)),
      timeout,
      debug: 'adblock'
    })
  ]
}

module.exports = { enableBlockingInPage, runAutoConsent, AUTOCONSENT_WORLD, AUTOCONSENT_BINDING }

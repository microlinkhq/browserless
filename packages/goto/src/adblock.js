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
  const receive = Object.prototype.hasOwnProperty.call(window, 'autoconsentReceiveMessage') && window.autoconsentReceiveMessage
  return typeof receive === 'function' ? receive(message) : undefined
}`

/* autoconsent sends objects through `autoconsentSendMessage`, while the CDP
   binding takes a string under its own name: Chrome re-installs bindings on a
   back/forward cache restore, which must not replace the wrapper.
   The injection runs after the document exists, so `window.<id>` can already
   resolve to a page element: an own `autoconsentReceiveMessage` property keeps
   autoconsent's startup guard from reading `<div id="autoconsentReceiveMessage">`.
   The first run in a world delivers `initResp` in the same evaluation, so
   prehide does not wait for an init round trip; its `init` is marked
   `preinitialized` for Node to skip the reply. */
const toContentScript = (autoconsentScript, initResp) => `{
  if (!Object.prototype.hasOwnProperty.call(window, 'autoconsentReceiveMessage')) {
    Object.defineProperty(window, 'autoconsentReceiveMessage', { value: undefined, writable: true, configurable: true });
  }
  const firstRun = typeof window.autoconsentReceiveMessage !== 'function';
  let bootstrapping = firstRun;
  window.autoconsentSendMessage = message => window.${AUTOCONSENT_BINDING}(JSON.stringify(
    bootstrapping && message && message.type === 'init' ? Object.assign({}, message, { preinitialized: true }) : message
  ));
  ${autoconsentScript}
  ;bootstrapping = false;
  if (firstRun && typeof window.autoconsentReceiveMessage === 'function') {
    window.autoconsentReceiveMessage(JSON.parse(${JSON.stringify(JSON.stringify(initResp))}));
  }
}`

const getContentScript = lazy(() =>
  Promise.all([getAutoconsentPlaywrightScript(), getAutoconsentRules()]).then(
    ([autoconsentScript, rules]) =>
      toContentScript(autoconsentScript, { type: 'initResp', config: autoconsentConfig, rules })
  )
)

const AUTOCONSENT_PREHIDE_ID = 'autoconsent-prehide'
const AUTOCONSENT_GLOBAL_PREHIDE =
  '#didomi-popup,.didomi-popup-container,.didomi-popup-notice,.didomi-consent-popup-preferences,#didomi-notice,.didomi-popup-backdrop,.didomi-screen-medium'

/* Mirrors autoconsent's own prehide (`style#autoconsent-prehide`, opacity rule)
   so it lands before the bundle is compiled; autoconsent appends to the same
   element and removes it, and an unclaimed prehide removes itself. */
const toPrehideScript = (selectors, patterned) => `{
  try {
    const receive = Object.prototype.hasOwnProperty.call(window, 'autoconsentReceiveMessage') && window.autoconsentReceiveMessage;
    if (typeof receive !== 'function' && !document.getElementById('${AUTOCONSENT_PREHIDE_ID}')) {
      const selector = [${JSON.stringify(selectors)}]
        .concat(${JSON.stringify(
          patterned
        )}.filter(([pattern]) => window.location.href.match(pattern)).map(([, patternSelectors]) => patternSelectors))
        .join(',');
      const css = selector + ' { opacity: 0 !important; z-index: -1 !important; pointer-events: none !important; } ';
      const style = document.createElement('style');
      style.id = '${AUTOCONSENT_PREHIDE_ID}';
      style.innerText = css;
      const append = () => (document.head || document.documentElement).appendChild(style);
      if (document.head || document.documentElement) append();
      else document.addEventListener('DOMContentLoaded', append, { once: true });
      setTimeout(() => { if (style.innerText === css) style.remove(); }, ${
        autoconsentConfig.prehideTimeout
      });
    }
  } catch {}
}`

const getPrehideScript = lazy(() =>
  getAutoconsentRules().then(compactRules => {
    const { decodeRules } = require('@duckduckgo/autoconsent')
    const topFrameRules = decodeRules(compactRules).filter(
      rule => rule.prehideSelectors?.length && rule.runContext?.main !== false
    )
    const selectors = topFrameRules
      .filter(rule => !rule.runContext?.urlPattern)
      .flatMap(rule => rule.prehideSelectors)
    const patterned = topFrameRules
      .filter(rule => rule.runContext?.urlPattern)
      .map(rule => [rule.runContext.urlPattern, rule.prehideSelectors.join(',')])
    return toPrehideScript([AUTOCONSENT_GLOBAL_PREHIDE, ...selectors].join(','), patterned)
  })
)

const injectContentScript = async (client, frameId, contentScript, prehideScript) => {
  const { executionContextId } = await client.send('Page.createIsolatedWorld', {
    frameId,
    worldName: AUTOCONSENT_WORLD
  })
  const prehide =
    prehideScript &&
    client
      .send('Runtime.evaluate', { expression: prehideScript, contextId: executionContextId })
      .catch(() => {})
  const result = await client.send('Runtime.evaluate', {
    expression: contentScript,
    contextId: executionContextId
  })
  await prehide
  return result
}

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
      if (message.preinitialized) return
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

const createAutoConsent = async (page, client, timeout) => {
  const topFrameContexts = (page._autoconsentContextIds = new Set())

  const detach = listenUntilClose(page, client, [
    [
      'Runtime.executionContextCreated',
      ({ context }) => {
        const isTopFrame = context.auxData?.frameId === page.mainFrame()._id
        if (context.name === AUTOCONSENT_WORLD) {
          if (isTopFrame) topFrameContexts.add(context.id)
        } else if (context.auxData?.isDefault && isTopFrame && page._autoconsentScript) {
          page._autoconsentInjection = injectContentScript(
            client,
            context.auxData.frameId,
            page._autoconsentScript,
            page._autoconsentPrehideScript
          ).then(
            ({ exceptionDetails }) => !exceptionDetails,
            error => {
              debug('autoconsent:inject:error', { message: error.message })
              return false
            }
          )
        }
      }
    ],
    [
      'Runtime.executionContextsCleared',
      () => {
        topFrameContexts.clear()
        page._autoconsentInitDone = false
        page._autoconsentInjection = undefined
      }
    ],
    [
      'Runtime.bindingCalled',
      ({ name, payload, executionContextId }) => {
        if (name !== AUTOCONSENT_BINDING || !topFrameContexts.has(executionContextId)) return
        const message = parseMessage(payload)
        if (message) {
          onMessage({ page, client, executionContextId, message, timeout }).catch(error =>
            debug('autoconsent:error', { message: error.message })
          )
        }
      }
    ]
  ])

  page._autoconsentDetach = detach

  try {
    const [contentScript, prehideScript] = await Promise.all([
      getContentScript(),
      getPrehideScript().catch(error => {
        debug('autoconsent:prehide:error', { message: error.message })
      })
    ])
    page._autoconsentPrehideScript = prehideScript
    await client.send('Runtime.addBinding', {
      name: AUTOCONSENT_BINDING,
      executionContextName: AUTOCONSENT_WORLD
    })
    page._autoconsentScript = contentScript
  } catch (error) {
    detach()
    throw error
  }
}

/* Puppeteer swaps the page to a new CDP session when a prerendered page is
   activated, so listeners and the binding follow the session, not the page. */
const setupAutoConsent = (page, timeout) => {
  const client = page._client()
  if (page._autoconsentSession !== client) {
    page._autoconsentDetach?.()
    page._autoconsentSession = client
    page._autoconsentSetup = createAutoConsent(page, client, timeout).catch(error => {
      if (page._autoconsentSession === client) {
        page._autoconsentSession = undefined
        page._autoconsentSetup = undefined
      }
      throw error
    })
  }
  return page._autoconsentSetup
}

/* Fallback for documents where the injection did not run or failed.
   `Page.createIsolatedWorld` returns the document's existing autoconsent world
   when there is one, where autoconsent's own guard skips a second instance. */
const runAutoConsent = async page => {
  if (page._autoconsentInitDone || !page._autoconsentScript) return
  if (await page._autoconsentInjection) return
  return injectContentScript(page._client(), page.mainFrame()._id, page._autoconsentScript)
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

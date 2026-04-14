'use strict'

const { PuppeteerBlocker } = require('@ghostery/adblocker-puppeteer')
const { randomUUID } = require('crypto')
const pTimeout = require('p-timeout')
const fs = require('fs/promises')
const path = require('path')

const debug = require('debug-logfmt')('browserless:goto:adblock')

const lazy = fn => {
  let p
  return () => (p ??= fn())
}

const autoconsentDir = path.dirname(require.resolve('@duckduckgo/autoconsent'))

const getEngine = lazy(() =>
  fs.readFile(path.resolve(__dirname, './engine.bin')).then(buffer => {
    const engine = PuppeteerBlocker.deserialize(new Uint8Array(buffer))
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
  /* skip bundled ABP/uBO cosmetic filter list (saves bundle size) */
  enableFilterList: false,
  /* detect CMPs using heuristics when no specific rule matches */
  enableHeuristicDetection: true,
  /* fall back to heuristic click when no specific rule matches */
  enableHeuristicAction: true,
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

const sendMessage = (page, message) =>
  page
    .evaluate(msg => {
      if (window.autoconsentReceiveMessage) {
        return window.autoconsentReceiveMessage(msg)
      }
    }, message)
    .catch(() => {})

const setupAutoConsent = async (page, timeout) => {
  if (page._autoconsentSetup) return
  const autoconsentPlaywrightScript = await getAutoconsentPlaywrightScript()
  const nonce = randomUUID()

  await page.exposeFunction('autoconsentSendMessage', async message => {
    if (!message || typeof message !== 'object') return
    if (message.__nonce !== nonce) return

    switch (message.type) {
      case 'init': {
        page._autoconsentInitDone = true
        const rules = await getAutoconsentRules()
        return sendMessage(page, { type: 'initResp', config: autoconsentConfig, rules })
      }

      case 'eval': {
        let result = false
        try {
          result = await pTimeout(page.evaluate(message.code), timeout)
        } catch {}
        return sendMessage(page, { type: 'evalResp', id: message.id, result })
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
  })

  /* Single injection: wrap the binding in the top frame so every outgoing
     message carries the nonce, then run the autoconsent script. Child frames
     keep the raw CDP binding which lacks the nonce, so their messages are
     silently rejected. */
  const nonceGuard = `(function(n){if(window.self!==window.top)return;var raw=window.autoconsentSendMessage;if(raw)window.autoconsentSendMessage=function(msg){return raw(Object.assign({},msg,{__nonce:n}))}})(${JSON.stringify(nonce)});`
  await page.evaluateOnNewDocument(nonceGuard + autoconsentPlaywrightScript)
  page._autoconsentSetup = true
}

const runAutoConsent = async page => {
  if (page._autoconsentInitDone) return
  return page.evaluate(await getAutoconsentPlaywrightScript())
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

module.exports = { enableBlockingInPage, runAutoConsent }

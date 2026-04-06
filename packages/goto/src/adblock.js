'use strict'

const { PuppeteerBlocker } = require('@ghostery/adblocker-puppeteer')
const fs = require('fs/promises')
const path = require('path')

const debug = require('debug-logfmt')('browserless:goto:adblock')

let enginePromise

const getEngine = () => {
  if (enginePromise) return enginePromise

  enginePromise = fs.readFile(path.resolve(__dirname, './engine.bin')).then(buffer => {
    const engine = PuppeteerBlocker.deserialize(new Uint8Array(buffer))
    engine.on('request-blocked', ({ url }) => debug('block', url))
    engine.on('request-redirected', ({ url }) => debug('redirect', url))
    return engine
  })

  return enginePromise
}

/**
 * autoconsent.playwright.js is the only browser-injectable IIFE bundle in the package.
 * It is not in the package's "exports" map, so pin @duckduckgo/autoconsent with ~ to
 * avoid breakage from internal restructuring on minor/patch bumps.
 */
let autoconsentPlaywrightScriptPromise

const getAutoconsentPlaywrightScript = () => {
  if (autoconsentPlaywrightScriptPromise) return autoconsentPlaywrightScriptPromise

  autoconsentPlaywrightScriptPromise = fs.readFile(
    path.resolve(
      path.dirname(require.resolve('@duckduckgo/autoconsent')),
      'autoconsent.playwright.js'
    ),
    'utf8'
  )

  return autoconsentPlaywrightScriptPromise
}

/* Configuration passed to autoconsent's `initResp` message.
   See https://github.com/duckduckgo/autoconsent/blob/main/api.md */
const autoconsentConfig = Object.freeze({
  /* activate consent rule matching */
  enabled: true,
  /* automatically reject (opt-out) all cookies */
  autoAction: 'optOut',
  /* hide banners early via CSS before detection finishes */
  enablePrehide: true,
  /* apply CSS-only rules that hide popups lacking a reject button */
  enableCosmeticRules: true,
  /* enable rules auto-generated from common CMP patterns */
  enableGeneratedRules: true,
  /* fall back to heuristic click when no specific rule matches */
  enableHeuristicAction: true,
  /* skip bundled ABP/uBO cosmetic filter list (saves bundle size) */
  enableFilterList: false,
  /* how many times to retry CMP detection (~50 ms apart) */
  detectRetries: 20,
  logs: {
    /* CMP detection / opt-out lifecycle events */
    lifecycle: false,
    /* individual rule step execution */
    rulesteps: false,
    /* eval snippet calls */
    evals: false,
    /* rule errors */
    errors: false,
    /* background ↔ content-script messages */
    messages: false
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

const setupAutoConsent = async page => {
  if (page._autoconsentSetup) return
  const autoconsentPlaywrightScript = await getAutoconsentPlaywrightScript()

  await page.exposeFunction('autoconsentSendMessage', async message => {
    if (!message || typeof message !== 'object') return

    if (message.type === 'init') {
      return sendMessage(page, { type: 'initResp', config: autoconsentConfig })
    }

    if (message.type === 'eval') {
      let result = false
      try {
        result = await page.evaluate(message.code)
      } catch {}
      return sendMessage(page, { type: 'evalResp', id: message.id, result })
    }
  })

  await page.evaluateOnNewDocument(autoconsentPlaywrightScript)
  page._autoconsentSetup = true
}

const runAutoConsent = async page => page.evaluate(await getAutoconsentPlaywrightScript())

const enableBlockingInPage = (page, run, actionTimeout) => {
  page.disableAdblock = () =>
    getEngine()
      .then(engine => engine.disableBlockingInPage(page, { keepRequestInterception: true }))
      .then(() => debug('disabled'))
      .catch(() => {})

  return [
    run({
      fn: setupAutoConsent(page),
      timeout: actionTimeout,
      debug: 'autoconsent:setup'
    }),
    run({
      fn: getEngine().then(engine => engine.enableBlockingInPage(page)),
      timeout: actionTimeout,
      debug: 'adblock'
    })
  ]
}

module.exports = { enableBlockingInPage, runAutoConsent }

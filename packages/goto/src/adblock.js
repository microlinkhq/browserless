'use strict'

const { PuppeteerBlocker } = require('@ghostery/adblocker-puppeteer')
const path = require('path')
const fs = require('fs')

const debug = require('debug-logfmt')('browserless:goto:adblock')

const engine = PuppeteerBlocker.deserialize(
  new Uint8Array(fs.readFileSync(path.resolve(__dirname, './engine.bin')))
)

engine.on('request-blocked', ({ url }) => debug('block', url))
engine.on('request-redirected', ({ url }) => debug('redirect', url))

/**
 * autoconsent.playwright.js is the only browser-injectable IIFE bundle in the package.
 * It is not in the package's "exports" map, so pin @duckduckgo/autoconsent with ~ to
 * avoid breakage from internal restructuring on minor/patch bumps.
 */
const autoconsentPlaywrightScript = fs.readFileSync(
  path.resolve(
    path.dirname(require.resolve('@duckduckgo/autoconsent')),
    'autoconsent.playwright.js'
  ),
  'utf8'
)

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

const isExposeFunctionAlreadyExistsError = error =>
  error &&
  error.name === 'Error' &&
  /already exists/i.test(error.message) &&
  /window/i.test(error.message)

const setupAutoConsent = async page => {
  if (page._autoconsentSetup) return

  const onAutoConsentMessage = async message => {
    if (!message || typeof message !== 'object') return

    try {
      if (message.type === 'init') {
        await page.evaluate(config => {
          if (window.autoconsentReceiveMessage) {
            return window.autoconsentReceiveMessage({ type: 'initResp', config })
          }
        }, autoconsentConfig)
      }

      if (message.type === 'eval' && message.id) {
        await page.evaluate(id => {
          if (window.autoconsentReceiveMessage) {
            return window.autoconsentReceiveMessage({ type: 'evalResp', id, result: false })
          }
        }, message.id)
      }
    } catch (_) {}
  }

  try {
    await page.exposeFunction('autoconsentSendMessage', onAutoConsentMessage)
  } catch (error) {
    if (!isExposeFunctionAlreadyExistsError(error)) throw error
  }

  await page.evaluateOnNewDocument(autoconsentPlaywrightScript)

  page._autoconsentSetup = true
}

const runAutoConsent = page => page.evaluate(autoconsentPlaywrightScript).catch(() => {})

const enableBlockingInPage = (page, run, actionTimeout) => {
  let adblockContext

  page.disableAdblock = () => {
    // TODO: drop this when https://github.com/ghostery/adblocker/pull/5161 is merged
    engine.contexts.delete(page)

    if (adblockContext.blocker.config.loadNetworkFilters) {
      adblockContext.page.off('request', adblockContext.onRequest)
    }

    if (adblockContext.blocker.config.loadCosmeticFilters) {
      adblockContext.page.off('frameattached', adblockContext.onFrameNavigated)
      adblockContext.page.off('domcontentloaded', adblockContext.onDomContentLoaded)
    }

    debug('disabled')
  }

  return [
    run({
      fn: setupAutoConsent(page),
      timeout: actionTimeout,
      debug: 'autoconsent:setup'
    }),
    run({
      fn: engine.enableBlockingInPage(page).then(context => (adblockContext = context)),
      timeout: actionTimeout,
      debug: 'adblock'
    })
  ]
}

module.exports = { enableBlockingInPage, runAutoConsent }

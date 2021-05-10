'use strict'

const { ensureError, browserTimeout, browserDisconnected } = require('@browserless/errors')
const createScreenshot = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const requireOneOf = require('require-one-of')
const createPdf = require('@browserless/pdf')
const parseProxy = require('parse-proxy-uri')
const mutexify = require('mutexify/promise')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const { AbortError } = pRetry

const driver = require('./driver')

const lock = mutexify()

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  incognito = false,
  timeout = 30000,
  proxy: proxyUrl,
  retry = 3,
  ...launchOpts
} = {}) => {
  const goto = createGoto({ puppeteer, timeout, ...launchOpts })
  const { defaultViewport } = goto
  const proxy = parseProxy(proxyUrl)

  const spawn = () => {
    const promise = driver.spawn(puppeteer, {
      defaultViewport,
      proxy,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...launchOpts
    })

    promise.then(async browser =>
      debug('spawn', { pid: driver.getPid(browser), version: await browser.version() })
    )

    return promise
  }

  let browserProcessPromise = spawn()

  const connect = async () => {
    let browserPromise = driver.connect(puppeteer, {
      browserWSEndpoint: (await browserProcessPromise).wsEndpoint(),
      defaultViewport,
      ...launchOpts
    })

    const reconnect = async ({ alreadyRespawned = false } = {}) => {
      if (!alreadyRespawned) {
        const { respawned } = await respawn()
        if (respawned) return reconnect({ alreadyRespawned: true })
      }

      browserPromise = driver.connect(puppeteer, {
        browserWSEndpoint: (await browserProcessPromise).wsEndpoint(),
        defaultViewport,
        ...launchOpts
      })
    }

    const createPage = async args => {
      const browser = await browserPromise

      debug('keepalive', { isConnected: browser.isConnected() })
      if (!browser.isConnected()) throw browserDisconnected()

      const context = incognito ? await browser.createIncognitoBrowserContext() : browser
      const page = await context.newPage()

      if (proxy) await page.authenticate(proxy)

      debug('createPage', {
        pid: driver.getPid(browser) || 'connect',
        incognito,
        pages: (await browser.pages()).length - 1,
        proxy: !!proxy,
        ...args
      })

      return page
    }

    const closePage = page => page && pReflect(page.close())

    const wrapError = (fn, { timeout: milliseconds = timeout } = {}) => async (...args) => {
      let isRejected = false

      async function run () {
        let page

        try {
          page = await createPage(args)
          const value = await fn(page)(...args)
          return value
        } catch (error) {
          throw ensureError(error)
        } finally {
          closePage(page)
        }
      }

      const task = () =>
        pRetry(run, {
          retries: retry,
          onFailedAttempt: error => {
            debug('onFailedAttempt', { name: error.name, isRejected })
            if (error.name === 'AbortError') throw error
            if (isRejected) throw new AbortError()
            reconnect()
            const { message, attemptNumber, retriesLeft } = error
            debug('retry', { attemptNumber, retriesLeft, message })
          }
        })

      return pTimeout(task(), milliseconds, () => {
        isRejected = true
        throw browserTimeout({ timeout: milliseconds })
      })
    }

    const evaluate = (fn, gotoOpts) =>
      wrapError(
        page => async (url, opts) => {
          const { response } = await goto(page, { url, ...gotoOpts, ...opts })
          return fn(page, response)
        },
        gotoOpts
      )

    const disconnect = () => browserPromise.then(browser => browser.disconnect())

    return {
      respawn,
      browser: () => browserPromise,
      evaluate,
      goto,
      html: evaluate(page => page.content()),
      page: createPage,
      pdf: wrapError(createPdf({ goto })),
      screenshot: wrapError(createScreenshot({ goto })),
      text: evaluate(page => page.evaluate(() => document.body.innerText)),
      getDevice: goto.getDevice,
      disconnect
    }
  }

  const respawn = async () => {
    const release = await lock()
    const browserProcess = await browserProcessPromise

    let respawned = false

    if (!browserProcess.isConnected()) {
      await Promise.all([
        browserProcessPromise.then(driver.close),
        (browserProcessPromise = spawn())
      ])
      respawned = true
    }

    release()

    return { respawned }
  }

  return {
    connect,
    respawn,
    browser: () => browserProcessPromise,
    close: opts => browserProcessPromise.then(browser => driver.close(browser, opts))
  }
}

module.exports.driver = driver

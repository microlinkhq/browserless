'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const createScreenshot = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const requireOneOf = require('require-one-of')
const createPdf = require('@browserless/pdf')
const parseProxy = require('parse-proxy-uri')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const driver = require('./driver')

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  incognito = false,
  timeout = 30000,
  proxy: proxyUrl,
  retry = 5,
  ...launchOpts
} = {}) => {
  const goto = createGoto({ puppeteer, timeout, ...launchOpts })
  const pageTimeout = timeout / 2 / 8
  const proxy = parseProxy(proxyUrl)

  const spawn = (spawnOpts = {}) => {
    const promise = driver.spawn(puppeteer, {
      defaultViewport: goto.defaultViewport,
      timeout: 0,
      proxy,
      ...launchOpts
    })
    promise.then(browser => debug('spawn', { pid: browser.process().pid, ...spawnOpts }))
    return promise
  }

  let browserPromise = spawn()

  const respawn = async () => {
    const { value } = await pReflect(browserPromise)
    await driver.destroy(value)
    browserPromise = spawn({ respawn: true })
  }

  const createPage = async () => {
    const browser = await browserPromise
    const context = incognito ? await browser.createIncognitoBrowserContext() : browser
    const page = await pTimeout(context.newPage(), pageTimeout, 'page hang out')

    if (proxy) await page.authenticate(proxy)

    debug('createPage', {
      pid: browser.process().pid,
      incognito,
      pages: (await browser.pages()).length - 1,
      proxy: !!proxy
    })

    return page
  }

  const closePage = page => page && pReflect(page.close())

  const wrapError = fn => async (...args) => {
    let isRejected = false

    async function run () {
      let page
      try {
        page = await createPage()
        const value = await fn(page)(...args)
        return value
      } catch (error) {
        throw ensureError(error)
      } finally {
        await closePage(page)
      }
    }

    const task = () =>
      pRetry(run, {
        retries: retry,
        onFailedAttempt: error => {
          if (error.name === 'AbortError') throw error
          if (isRejected) throw new pRetry.AbortError()
          respawn()
          const { message, attemptNumber, retriesLeft } = error
          debug('retry', { attemptNumber, retriesLeft, message })
        }
      })

    return pTimeout(task(), timeout, () => {
      isRejected = true
      throw browserTimeout({ timeout })
    })
  }

  const evaluate = (fn, gotoOpts) =>
    wrapError(page => async (url, opts) => {
      const { response } = await goto(page, { url, ...gotoOpts, ...opts })
      return fn(page, response)
    })

  return {
    // low level methods
    browser: browserPromise,
    close: async () => (await browserPromise).close(),
    destroy: async opts => driver.destroy(await browserPromise, opts),
    respawn,
    // high level methods
    evaluate,
    goto,
    html: evaluate(page => page.content()),
    page: createPage,
    pdf: wrapError(createPdf({ goto })),
    screenshot: wrapError(createScreenshot({ goto })),
    text: evaluate(page => page.evaluate(() => document.body.innerText)),
    getDevice: goto.getDevice
  }
}

module.exports.driver = driver

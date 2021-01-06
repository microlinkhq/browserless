'use strict'

const { ensureError, browserTimeout, browserDisconnected } = require('@browserless/errors')
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
  const proxy = parseProxy(proxyUrl)

  const spawn = (spawnOpts = {}) => {
    const promise = driver.spawn(puppeteer, {
      defaultViewport: goto.defaultViewport,
      timeout: 0,
      proxy,
      ...launchOpts
    })

    pReflect(promise).then(
      ({ value: browser }) =>
        browser &&
        debug('spawn', {
          pid: driver.get(browser).pid || launchOpts.mode,
          ...spawnOpts
        })
    )

    return promise
  }

  let browserPromise = spawn()

  const getBrowser = async () => {
    const browser = await browserPromise
    if (!browser.isConnected()) throw browserDisconnected()
    return browser
  }

  const respawn = async () => {
    const { value } = await pReflect(browserPromise)
    await driver.destroy(value)
    browserPromise = spawn({ respawn: true })
  }

  const createPage = async () => {
    const browser = await getBrowser()
    const context = incognito ? await browser.createIncognitoBrowserContext() : browser
    const page = await context.newPage()

    if (proxy) await page.authenticate(proxy)

    debug('createPage', {
      pid: driver.get(browser).pid || launchOpts.mode,
      incognito,
      pages: (await browser.pages()).length - 1,
      proxy: !!proxy
    })

    return page
  }

  const closePage = page => page && pReflect(page.close())

  const wrapError = fn => async (...args) => {
    async function run () {
      const page = await createPage()
      const value = await fn(page)(...args)
      await closePage(page)
      return value
    }

    const task = () =>
      pRetry(run, {
        retries: retry,
        onFailedAttempt: error => {
          respawn()
          const { message, attemptNumber, retriesLeft } = ensureError(error)
          debug('retry', { attemptNumber, retriesLeft, message })
        }
      })

    return pTimeout(task(), timeout, () => {
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
    browser: getBrowser,
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

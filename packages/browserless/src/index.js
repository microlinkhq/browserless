'use strict'

const createScreenshot = require('@browserless/screenshot')
const { browserTimeout } = require('@browserless/errors')
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
  retries = 5,
  ...launchOpts
} = {}) => {
  const goto = createGoto({ puppeteer, timeout, ...launchOpts })
  const proxy = parseProxy(proxyUrl)

  const spawn = () =>
    driver.spawn(puppeteer, {
      defaultViewport: goto.defaultViewport,
      timeout: 0,
      proxy,
      ...launchOpts
    })

  let browser = spawn()

  const respawn = async () => {
    const { value } = await pReflect(browser)
    await driver.destroy(value)
    browser = spawn()
  }

  const createPage = async () => {
    const _browser = await browser
    const context = incognito ? await _browser.createIncognitoBrowserContext() : _browser
    const page = await context.newPage()

    if (proxy) await page.authenticate(proxy)

    debug('new page', {
      pid: _browser.process().pid,
      incognito,
      pages: (await _browser.pages()).length - 1,
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
        throw 'error' in error ? error.error : error
      } finally {
        await closePage(page)
      }
    }

    const task = () =>
      pRetry(run, {
        retries,
        onFailedAttempt: async error => {
          if (error.name === 'AbortError') throw error
          if (isRejected) throw new pRetry.AbortError()
          await respawn()
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
    browser,
    close: async () => (await browser).close(),
    destroy: async opts => driver.destroy(await browser, opts),
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

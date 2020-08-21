'use strict'

const createScreenshot = require('@browserless/screenshot')
const { browserTimeout } = require('@browserless/errors')
const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const requireOneOf = require('require-one-of')
const createPdf = require('@browserless/pdf')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const driver = require('./driver')

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  incognito = false,
  timeout = 30000,
  retries = 5,
  ...launchOpts
} = {}) => {
  const goto = createGoto({ puppeteer, timeout, ...launchOpts })

  let browser = driver.spawn(puppeteer, {
    defaultViewport: goto.defaultViewport,
    timeout: 0,
    ...launchOpts
  })

  const respawn = async () => {
    await driver.destroy(await browser)
    browser = driver.spawn(puppeteer, launchOpts)
  }

  const createPage = async () => {
    const _browser = await browser
    const context = incognito ? await _browser.createIncognitoBrowserContext() : _browser
    const page = await context.newPage()
    debug('new page', {
      pid: _browser.process().pid,
      incognito,
      pages: (await _browser.pages()).length - 1
    })
    return page
  }

  const wrapError = fn => async (...args) => {
    let isRejected = false
    let page

    const closePage = () => (page ? pReflect(page.close()) : undefined)

    const run = async () => {
      const { isFulfilled, value, reason } = await pReflect(fn(await createPage())(...args))
      await closePage()
      if (isFulfilled) return value
      throw reason
    }

    const task = () =>
      pRetry(run, {
        retries,
        onFailedAttempt: async error => {
          if (!(error instanceof Error) && 'error' in error) error = error.error
          if (error.name === 'AbortError') throw error
          if (isRejected) throw new pRetry.AbortError()
          const { message, attemptNumber, retriesLeft } = error
          debug('retry', { attemptNumber, retriesLeft, message })
          await respawn()
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

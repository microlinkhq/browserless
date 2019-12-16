'use strict'

const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const PCancelable = require('p-cancelable')
const importLazy = require('import-lazy')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const driver = require('./browser')

module.exports = ({
  puppeteer = require('require-one-of')(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  puppeteerDevices,
  incognito = false,
  timeout = 30000,
  ...launchOpts
} = {}) => {
  let browser = driver.spawn(puppeteer, launchOpts)

  const respawn = async () => {
    const destroyResult = await driver.destroy(await browser)
    debug('destroy', destroyResult)
    browser = driver.spawn(puppeteer, launchOpts)
  }

  const goto = createGoto({ puppeteerDevices })

  const createPage = async () => {
    const _browser = await browser
    debug('createPage', {
      pid: _browser.process().pid,
      incognito,
      pages: (await _browser.pages()).length
    })
    const context = incognito ? await _browser.createIncognitoBrowserContext() : _browser
    const page = await context.newPage()
    return page
  }

  const wrapError = fn => async (...args) => {
    let page

    const closePage = () => (page ? pReflect(page.close()) : undefined)

    const run = async () =>
      new PCancelable(async (resolve, reject, onCancel) => {
        onCancel(closePage)
        try {
          page = await createPage()
          const value = await fn(page)(...args)
          closePage()
          return resolve(value)
        } catch (err) {
          closePage()
          return reject(err)
        }
      })

    const task = () =>
      pRetry(run, {
        retries: 2,
        onFailedAttempt: async error => {
          const { message, attemptNumber, retriesLeft } = error
          debug('retry', { attemptNumber, retriesLeft, message })
          if (message.startsWith('net::')) throw error
        }
      })

    const { isRejected, value, reason } = await pReflect(pTimeout(task(), timeout))
    if (isRejected) throw reason
    return value
  }

  const evaluate = (fn, gotoOpts) =>
    wrapError(page => async (url, opts) => {
      const { response } = await goto(page, { url, ...gotoOpts, ...opts })
      return fn(page, response)
    })

  const pdf = wrapError(page => importLazy(require('@browserless/pdf')({ goto }))(page))

  const screenshot = wrapError(page =>
    importLazy(require('@browserless/screenshot')({ goto }))(page)
  )

  return {
    // low level methods
    browser,
    close: async () => (await browser).close(),
    kill: async opts => driver.kill((await browser).process().pid, opts),
    destroy: async opts => driver.destroy(await browser, opts),
    respawn,
    // high level methods
    evaluate,
    goto,
    html: evaluate(page => page.content(), { disableAnimations: false }),
    page: createPage,
    pdf,
    screenshot,
    text: evaluate(page => page.evaluate(() => document.body.innerText), {
      disableAnimations: false
    }),
    getDevice: goto.getDevice
  }
}

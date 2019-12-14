'use strict'

const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
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

    const run = async () => {
      page = await createPage()
      return fn(page)(...args)
    }

    const result = await pReflect(
      pTimeout(
        pRetry(run, {
          onFailedAttempt: error => {
            const { message, attemptNumber } = error
            if (message.startsWith('net::ERR_ABORTED')) throw error
            debug('wrapError:retry', { attemptNumber, message })
          }
        }),
        timeout
      )
    )

    if (page) await pReflect(page.close())
    if (result.isRejected) throw result.reason
    return result.value
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

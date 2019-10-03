'use strict'

const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const importLazy = require('import-lazy')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const driver = require('./browser')

const EVALUATE_TEXT = page => page.evaluate(() => document.body.innerText)

const EVALUATE_HTML = page => page.content()

module.exports = ({
  puppeteer = require('require-one-of')(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  puppeteerDevices,
  incognito = false,
  timeout = 30000,
  ...launchOpts
} = {}) => {
  let browser = driver.spawn(puppeteer, launchOpts)

  const respawn = async () => {
    const destroyResult = await driver.destroy(await browser, { cleanup: true })
    debug('destroy', destroyResult)
    browser = driver.spawn(puppeteer, launchOpts)
  }

  const goto = createGoto({ puppeteerDevices })

  const createPage = () =>
    pRetry(
      async () => {
        const _browser = await browser
        debug('createPage', { pid: _browser.process().pid })
        const context = incognito ? await _browser.createIncognitoBrowserContext() : _browser
        const page = await context.newPage()
        page.setDefaultNavigationTimeout(timeout)
        return page
      },
      {
        onFailedAttempt: err => {
          debug('createPage:retry', {
            attemptNumber: err.attemptNumber
          })
          return respawn()
        }
      }
    )

  const wrapError = fn => async (...args) => {
    const page = await createPage()
    const result = await pReflect(pTimeout(fn(page)(...args), timeout))
    await pReflect(page.close())
    if (result.isRejected) throw result.reason
    return result.value
  }

  const evaluate = fn =>
    wrapError(page => async (url, opts = {}) => {
      const response = await goto(page, { url, ...opts })
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
    html: evaluate(EVALUATE_HTML),
    page: createPage,
    pdf,
    screenshot,
    text: evaluate(EVALUATE_TEXT),
    devices: goto.devices
  }
}

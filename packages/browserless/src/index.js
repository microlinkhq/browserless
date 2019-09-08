'use strict'

const devices = require('@browserless/devices')
const requireOneOf = require('require-one-of')
const goto = require('@browserless/goto')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')

const driver = require('./browser')

const EVALUATE_TEXT = page => page.evaluate(() => document.body.innerText)

const EVALUATE_HTML = page => page.content()

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  incognito = false,
  timeout = 30000,
  ...launchOpts
} = {}) => {
  let browser = driver.spawn(puppeteer, launchOpts)

  const respawn = async () => {
    await driver.destroy(await browser, { cleanTmp: true })
    browser = driver.spawn(puppeteer, launchOpts)
  }

  const createPage = () =>
    Promise.resolve(browser).then(async browser => {
      const context = incognito ? await browser.createIncognitoBrowserContext() : browser
      const page = await context.newPage()
      page.setDefaultNavigationTimeout(timeout)
      return page
    })

  const wrapError = fn => async (...args) => {
    const page = await createPage()
    const result = await pReflect(pTimeout(fn(page)(...args), timeout))
    await page.close()
    if (result.isRejected) throw result.reason
    return result.value
  }

  const evaluate = fn =>
    wrapError(page => async (url, opts = {}) => {
      const response = await goto(page, { url, ...opts })
      return fn(page, response)
    })

  const pdf = wrapError(require('@browserless/pdf'))

  const screenshot = wrapError(require('@browserless/screenshot'))

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
    text: evaluate(EVALUATE_TEXT)
  }
}

module.exports.devices = devices

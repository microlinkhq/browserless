'use strict'

const requireOneOf = require('require-one-of')
const goto = require('@browserless/goto')
const pTimeout = require('p-timeout')

const EVALUATE_TEXT = page => page.evaluate(() => document.body.innerText)

const EVALUATE_HTML = page => page.content()

module.exports = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  incognito = false,
  timeout = 30000,
  ...launchOpts
} = {}) => {
  let browser = puppeteer.launch({
    ignoreHTTPSErrors: true,
    args: [
      '--disable-notifications',
      '--disable-offer-store-unmasked-wallet-cards',
      '--disable-offer-upload-credit-cards',
      '--disable-setuid-sandbox',
      '--enable-async-dns',
      '--enable-simple-cache-backend',
      '--enable-tcp-fast-open',
      '--media-cache-size=33554432',
      '--no-default-browser-check',
      '--no-pings',
      '--no-sandbox',
      '--no-zygote',
      '--prerender-from-omnibox=disabled'
    ],
    ...launchOpts
  })

  const newPage = () =>
    Promise.resolve(browser).then(async browser => {
      const context = incognito ? await browser.createIncognitoBrowserContext() : browser
      const page = await context.newPage()
      page.setDefaultNavigationTimeout(timeout)
      return page
    })

  const wrapError = fn => async (...args) => {
    const page = await newPage()
    let error
    let res

    try {
      res = await pTimeout(fn(page)(...args), timeout)
    } catch (err) {
      error = err
    }

    await page.close()
    if (error) throw error
    return res
  }

  const evaluate = fn =>
    wrapError(page => async (url, opts = {}) => {
      const {
        abortTrackers = true,
        abortTypes = ['image', 'imageset', 'media', 'stylesheet', 'font', 'object', 'sub_frame'],
        ...args
      } = opts

      const response = await goto(page, {
        url,
        abortTrackers,
        abortTypes,
        ...args
      })

      return fn(page, response)
    })

  const screenshot = wrapError(page => async (url, opts = {}) => {
    const { device = 'macbook pro 13', tmpOpts, type = 'png', viewport, ...args } = opts

    await goto(page, { url, device, ...args })
    return page.screenshot({ type, ...args })
  })

  const pdf = wrapError(page => async (url, opts = {}) => {
    const {
      format = 'A4',
      margin = {
        top: '0.25cm',
        right: '0.25cm',
        bottom: '0.25cm',
        left: '0.25cm'
      },
      media = 'screen',
      printBackground = true,
      scale = 0.65,
      tmpOpts,
      viewport,
      ...args
    } = opts

    await page.emulateMedia(media)
    await goto(page, { url, ...args })
    return page.pdf({
      margin,
      format,
      printBackground,
      scale,
      ...args
    })
  })

  return {
    browser,
    html: evaluate(EVALUATE_HTML),
    text: evaluate(EVALUATE_TEXT),
    evaluate,
    pdf,
    screenshot,
    page: newPage,
    goto
  }
}

module.exports.devices = require('./devices')

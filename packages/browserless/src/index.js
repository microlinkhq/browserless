'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const createScreenshot = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const createPdf = require('@browserless/pdf')
const parseProxy = require('parse-proxy-uri')
const mutexify = require('mutexify/promise')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const { AbortError } = pRetry

const driver = require('./driver')

const lock = mutexify()

module.exports = ({ timeout = 30000, proxy: proxyUrl, retry = 2, ...launchOpts } = {}) => {
  const goto = createGoto({ timeout, ...launchOpts })
  const { defaultViewport } = goto
  const proxy = parseProxy(proxyUrl)

  let isClosed = false

  const close = opts => {
    isClosed = true
    return browserProcessPromise.then(browserProcess => driver.close(browserProcess, opts))
  }

  const respawn = () =>
    !isClosed &&
    Promise.all([
      browserProcessPromise.then(driver.close),
      (browserProcessPromise = spawn({ respawn: true }))
    ])

  const spawn = ({ respawn: isRespawn = false } = {}) => {
    const promise = driver.spawn({
      defaultViewport,
      proxy,
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      ...launchOpts
    })

    promise.then(async browser => {
      debug('spawn', {
        respawn: isRespawn,
        pid: driver.getPid(browser) || launchOpts.mode,
        version: await browser.version()
      })
    })

    return promise
  }

  let browserProcessPromise = spawn()

  const createBrowserContext = () =>
    browser().then(browser => browser.createIncognitoBrowserContext())

  const browser = async () => {
    const release = await lock()
    const browserProcess = await browserProcessPromise

    if (browserProcess.isConnected()) {
      release()
      return browserProcess
    }

    await respawn()
    release()

    return browser()
  }

  const createContext = () => {
    let contextPromise = createBrowserContext()

    contextPromise.then(context => {
      const browserProcess = context.browser()
      browserProcess.on('disconnected', async () => {
        await browser()
        contextPromise = createBrowserContext()
      })
    })

    const createPage = async () => {
      const browserProcess = await browser()
      const page = await (await contextPromise).newPage()

      if (proxy) await page.authenticate(proxy)

      debug('createPage', { pid: driver.getPid(browserProcess), proxy: !!proxy })

      return page
    }

    const closePage = async page => {
      let info
      if (page) info = await pReflect(page.close())
      debug('closePage', { page: !!page, ...info })
    }

    const wrapError = (fn, { timeout: milliseconds = timeout } = {}) => async (...args) => {
      let isRejected = false

      async function run () {
        let page

        try {
          page = await createPage(args)
          const value = await fn(page)(...args)
          await closePage(page)
          return value
        } catch (error) {
          await closePage(page)
          throw ensureError(error)
        }
      }

      const task = () =>
        pRetry(run, {
          retries: retry,
          onFailedAttempt: async error => {
            debug('onFailedAttempt', { name: error.name, code: error.code, isRejected })

            if (error.name === 'AbortError') throw error
            if (isRejected) throw new AbortError()

            await Promise.all([destroyContext(), respawn()])
            contextPromise = createBrowserContext()

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

    const destroyContext = async () => pReflect((await contextPromise).close())

    return {
      respawn,
      context: () => contextPromise,
      browser,
      evaluate,
      goto,
      html: evaluate(page => page.content()),
      page: createPage,
      pdf: wrapError(createPdf({ goto })),
      screenshot: wrapError(createScreenshot({ goto })),
      text: evaluate(page => page.evaluate(() => document.body.innerText)),
      getDevice: goto.getDevice,
      destroyContext
    }
  }

  return { createContext, respawn, browser, close }
}

module.exports.driver = driver

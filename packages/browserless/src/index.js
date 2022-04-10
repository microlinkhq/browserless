'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const createScreenshot = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const createPdf = require('@browserless/pdf')
const mutexify = require('mutexify/promise')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const { AbortError } = pRetry

const driver = require('./driver')

const lock = mutexify()

module.exports = ({ timeout: globalTimeout = 30000, ...launchOpts } = {}) => {
  const goto = createGoto({ timeout: globalTimeout, ...launchOpts })
  const { defaultViewport } = goto

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
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
      timeout: globalTimeout,
      ...launchOpts
    })

    promise.then(async browser => {
      browser.once('disconnected', getBrowser)
      const pid = driver.getPid(browser)

      debug('spawn', {
        respawn: isRespawn,
        pid: pid || launchOpts.mode,
        version: await browser.version()
      })
    })

    return promise
  }

  let browserProcessPromise = spawn()

  const createBrowserContext = () =>
    getBrowser().then(browser => browser.createIncognitoBrowserContext())

  const getBrowser = async () => {
    if (isClosed) return browserProcessPromise

    const release = await lock()
    const browserProcess = await browserProcessPromise

    if (browserProcess.isConnected()) {
      release()
      return browserProcess
    }

    await respawn()
    release()

    return getBrowser()
  }

  const createContext = async ({ retry = 2, timeout: contextTimeout } = {}) => {
    let _contextPromise = createBrowserContext()

    const getBrowserContext = () => _contextPromise

    getBrowserContext().then(context => {
      const browserProcess = context.browser()
      browserProcess.once('disconnected', async () => {
        await getBrowser()
        _contextPromise = createBrowserContext()
      })
    })

    const createPage = async () => {
      const [browserProcess, browserContext] = await Promise.all([
        getBrowser(),
        getBrowserContext()
      ])
      const page = await browserContext.newPage()
      debug('createPage', { pid: driver.getPid(browserProcess), id: browserContext._id })
      return page
    }

    const closePage = async page => {
      if (page && !page.isClosed()) {
        const [browserProcess, browserContext] = await Promise.all([
          getBrowser(),
          getBrowserContext(),
          pReflect(page.close())
        ])
        debug('closePage', { pid: driver.getPid(browserProcess), id: browserContext._id })
      }
    }

    const wrapError = (fn, { timeout: evaluateTimeout } = {}) => async (...args) => {
      let isRejected = false

      async function run () {
        let page

        try {
          page = await createPage(args)
          setTimeout(() => closePage(page), timeout)
          const value = await fn(page)(...args)
          await closePage(page)
          return value
        } catch (error) {
          await closePage(page)
          if (!isRejected) throw ensureError(error)
        }
      }

      const task = () =>
        pRetry(run, {
          retries: retry,
          onFailedAttempt: async error => {
            debug('onFailedAttempt', { name: error.name, code: error.code, isRejected })
            if (error.name === 'AbortError') throw error
            if (isRejected) throw new AbortError()
            if (error.code === 'EBRWSRCONTEXTCONNRESET') _contextPromise = createBrowserContext()
            const { message, attemptNumber, retriesLeft } = error
            debug('retry', { attemptNumber, retriesLeft, message })
          }
        })

      const timeout = evaluateTimeout || contextTimeout || globalTimeout

      return pTimeout(task(), timeout, () => {
        isRejected = true
        throw browserTimeout({ timeout })
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

    const destroyContext = async () => {
      const [browserProcess, browserContext] = await Promise.all([
        getBrowser(),
        getBrowserContext()
      ])
      const id = browserContext._id
      await pReflect(browserContext.close())

      debug('destroyContext', { pid: driver.getPid(browserProcess), id })
    }

    return {
      respawn,
      context: getBrowserContext,
      browser: getBrowser,
      evaluate,
      goto,
      html: evaluate(page => page.content(), { animations: true }),
      page: createPage,
      pdf: wrapError(createPdf({ goto })),
      screenshot: wrapError(createScreenshot({ goto })),
      text: evaluate(page => page.evaluate(() => document.body.innerText)),
      getDevice: goto.getDevice,
      destroyContext
    }
  }

  return { createContext, respawn, browser: getBrowser, close }
}

module.exports.driver = driver

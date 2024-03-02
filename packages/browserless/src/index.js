'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const createScreenshot = require('@browserless/screenshot')
const debug = require('debug-logfmt')('browserless')
const createGoto = require('@browserless/goto')
const createPdf = require('@browserless/pdf')
const { withLock } = require('superlock')
const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const { AbortError } = pRetry

const driver = require('./driver')

const lock = withLock()

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
      if (launchOpts.mode !== 'connect') browser.once('disconnected', getBrowser)
      debug('spawn', {
        respawn: isRespawn,
        pid: driver.pid(browser) || launchOpts.mode,
        version: await browser.version().catch(() => {})
      })
    })

    return promise
  }

  let browserProcessPromise = spawn()

  const createBrowserContext = contextOpts =>
    getBrowser().then(browser => browser.createBrowserContext(contextOpts))

  const getBrowser = async () => {
    if (isClosed) return browserProcessPromise
    const browserProcess = await lock(async () => {
      const browserProcess = await browserProcessPromise
      if (browserProcess.isConnected()) return browserProcess
      respawn()
    })

    return browserProcess || getBrowser()
  }

  const createContext = async ({ retry = 2, timeout: contextTimeout, ...contextOpts } = {}) => {
    let _contextPromise = createBrowserContext(contextOpts)
    let isDestroyedForced = false

    const getBrowserContext = () => _contextPromise

    const createPage = async () => {
      const [browserProcess, browserContext] = await Promise.all([
        getBrowser(),
        getBrowserContext()
      ])
      const page = await browserContext.newPage()
      debug('createPage', { pid: driver.pid(browserProcess), id: browserContext.id })
      return page
    }

    const closePage = async page => {
      if (page && !page.isClosed()) {
        const [browserProcess, browserContext] = await Promise.all([
          getBrowser(),
          getBrowserContext(),
          pReflect(page.close())
        ])
        debug('closePage', { pid: driver.pid(browserProcess), id: browserContext.id })
      }
    }

    const withPage =
      (fn, { timeout: evaluateTimeout } = {}) =>
        async (...args) => {
          let isRejected = false

          async function run () {
            let page

            try {
              page = await createPage(args)
              setTimeout(() => closePage(page), timeout).unref()
              const value = await fn(page, goto)(...args)
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
                if (isRejected || isDestroyedForced) throw new AbortError()
                if (error.code === 'EBRWSRCONTEXTCONNRESET') {
                  _contextPromise = createBrowserContext(contextOpts)
                }
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
      withPage(
        (page, goto) => async (url, opts) => {
          const { response, error } = await goto(page, { url, ...gotoOpts, ...opts })
          return fn(page, response, error)
        },
        gotoOpts
      )

    const destroyContext = async ({ force = false } = {}) => {
      if (force) isDestroyedForced = true

      const [browserProcess, browserContext] = await Promise.all([
        getBrowser(),
        getBrowserContext()
      ])
      await pReflect(browserContext.close())
      debug('destroyContext', { pid: driver.pid(browserProcess), force, id: browserContext.id })
    }

    return {
      respawn,
      context: getBrowserContext,
      browser: getBrowser,
      evaluate,
      goto,
      html: evaluate(page => page.content()),
      page: createPage,
      pdf: withPage(createPdf({ goto })),
      screenshot: withPage(createScreenshot({ goto })),
      text: evaluate(page => page.evaluate(() => document.body.innerText)),
      getDevice: goto.getDevice,
      destroyContext,
      withPage
    }
  }

  return { createContext, respawn, browser: getBrowser, close, isClosed: () => isClosed }
}

module.exports.driver = driver

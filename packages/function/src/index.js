'use strict'

const { isBrowserlessError, ensureError } = require('@browserless/errors')
const requireOneOf = require('require-one-of')
const runFunction = require('./function')

const stringify = fn => fn.toString().trim().replace(/;$/, '')

module.exports = (
  fn,
  {
    getBrowserless = requireOneOf(['browserless']),
    retry = 2,
    timeout = 30000,
    gotoOpts,
    ...opts
  } = {}
) => {
  const code = stringify(fn)
  const needsNetwork = runFunction.isUsingPage(code)
  const source = runFunction.buildTemplate(code, needsNetwork)
  let browserPromise

  const getBrowser = async () => {
    if (!browserPromise) {
      browserPromise = Promise.resolve(getBrowserless()).catch(error => {
        browserPromise = undefined
        throw error
      })
    }
    return browserPromise
  }

  return async (url, fnOpts = {}) => {
    const browser = await getBrowser()
    const browserless = await browser.createContext()

    return browserless.withPage((page, goto) => async () => {
      const { device } = await goto(page, { url, timeout, ...gotoOpts })

      const runFunctionOpts = {
        url,
        code,
        device,
        ...opts,
        ...fnOpts
      }

      if (runFunctionOpts.code === code) {
        runFunctionOpts.needsNetwork = needsNetwork
        runFunctionOpts.source = source
      }

      if (runFunctionOpts.needsNetwork !== false) {
        const browserFromPage = typeof page.browser === 'function' ? page.browser() : undefined
        const browserWSEndpoint =
          browserFromPage && typeof browserFromPage.wsEndpoint === 'function'
            ? browserFromPage.wsEndpoint()
            : undefined

        if (!browserWSEndpoint) throw new Error('Browser WebSocket endpoint not found')
        runFunctionOpts.browserWSEndpoint = browserWSEndpoint
      }

      const result = await runFunction(runFunctionOpts)

      if (result.isFulfilled) return result
      const error = ensureError(result.value)
      if (isBrowserlessError(error)) throw error
      return result
    })()
  }
}

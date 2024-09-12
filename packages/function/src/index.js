'use strict'

const { isBrowserlessError, ensureError } = require('@browserless/errors')
const requireOneOf = require('require-one-of')
const runFunction = require('./function')

const stringify = fn => fn.toString().trim().replace(/;$/, '')

module.exports =
  (
    fn,
    {
      getBrowserless = requireOneOf(['browserless']),
      retry = 2,
      timeout = 30000,
      gotoOpts,
      ...opts
    } = {}
  ) =>
    async (url, fnOpts = {}) => {
      const browserlessPromise = getBrowserless()
      const browser = await browserlessPromise
      const browserless = await browser.createContext()

      return browserless.withPage((page, goto) => async () => {
        const { device } = await goto(page, { url, timeout, ...gotoOpts })
        const result = await runFunction({
          url,
          code: stringify(fn),
          browserWSEndpoint: (await browserless.browser()).wsEndpoint(),
          device,
          ...opts,
          ...fnOpts
        })

        if (result.isFulfilled) return result
        const error = ensureError(result.value)
        if (isBrowserlessError(error)) throw error
        return result
      })()
    }

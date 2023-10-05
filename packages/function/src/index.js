'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const debug = require('debug-logfmt')('browserless:function')
const requireOneOf = require('require-one-of')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const { AbortError } = pRetry

const runFunction = require('./function')

const stringify = fn => fn.toString().trim().replace(/;$/, '')

module.exports = (
  fn,
  { getBrowserless = requireOneOf(['browserless']), retry = 2, timeout = 30000, ...opts } = {}
) => {
  return async (url, fnOpts = {}) => {
    const browserlessPromise = getBrowserless()
    let isRejected = false

    async function run () {
      const browserless = await browserlessPromise
      const browser = await browserless.browser()
      const browserWSEndpoint = browser.wsEndpoint()

      const { value, reason, isFulfilled } = await runFunction({
        url,
        code: stringify(fn),
        browserWSEndpoint,
        ...opts,
        ...fnOpts
      })

      if (isFulfilled) return value
      throw ensureError(reason)
    }

    const task = () =>
      pRetry(run, {
        retries: retry,
        onFailedAttempt: async error => {
          if (error.name === 'AbortError') throw error
          if (isRejected) throw new AbortError()
          await (await browserlessPromise).respawn()
          const { message, attemptNumber, retriesLeft } = error
          debug('retry', { attemptNumber, retriesLeft, message })
        }
      })

    // main
    const result = await pTimeout(task(), timeout, () => {
      isRejected = true
      throw browserTimeout({ timeout })
    })

    return result
  }
}

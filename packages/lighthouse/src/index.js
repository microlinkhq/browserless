'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const debug = require('debug-logfmt')('browserless:lighthouse')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')

const lighthouse = require('./lighthouse')
const getConfig = require('./get-config')

const { AbortError } = pRetry

// See https://github.com/GoogleChrome/lighthouse/blob/master/docs/readme.md#configuration
const getFlags = (
  browser,
  { disableStorageReset = true, logLevel = 'error', output = 'json' }
) => ({
  disableStorageReset,
  logLevel,
  output,
  port: new URL(browser.wsEndpoint()).port
})

module.exports = async (
  url,
  {
    disableStorageReset,
    getBrowserless = require('browserless'),
    logLevel,
    output,
    retry = 2,
    timeout = 30000,
    ...opts
  } = {}
) => {
  const browserlessPromise = getBrowserless()
  let isRejected = false

  async function run () {
    const browserless = await browserlessPromise
    const browser = await browserless.browser()
    const flags = await getFlags(browser, { disableStorageReset, logLevel, output })
    const { value, reason, isFulfilled } = await lighthouse({
      config: await getConfig(opts),
      flags,
      url
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

  const result = await pTimeout(task(), timeout, () => {
    isRejected = true
    throw browserTimeout({ timeout })
  })

  return result
}

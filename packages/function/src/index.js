'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const debug = require('debug-logfmt')('browserless:function')
const requireOneOf = require('require-one-of')
const { Worker } = require('worker_threads')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')
const pEvent = require('p-event')
const path = require('path')

const { AbortError } = pRetry

const execPath = path.resolve(__dirname, 'function.js')

module.exports = (
  fn,
  { getBrowserless = requireOneOf(['browserless']), retry = 2, timeout = 30000, ...opts } = {}
) => {
  return async (url, { workerOpts, ...fnOpts } = {}) => {
    const browserlessPromise = getBrowserless()
    let isRejected = false

    async function run () {
      const browserless = await browserlessPromise
      const browser = await browserless.browser()
      const browserWSEndpoint = browser.wsEndpoint()

      const worker = new Worker(execPath, {
        ...workerOpts,
        workerData: {
          url,
          code: fn
            .toString()
            .trim()
            .replace(/;$/, ''),
          browserWSEndpoint,
          ...opts,
          ...fnOpts
        }
      })

      debug('spawn', { pid: process.pid, thread: worker.threadId })
      const { value, reason, isFulfilled } = JSON.parse(await pEvent(worker, 'message'))

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

'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const debug = require('debug-logfmt')('browserless:function')
const requireOneOf = require('require-one-of')
const { driver } = require('browserless')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')
const pEvent = require('p-event')
const execa = require('execa')
const path = require('path')

const { AbortError } = pRetry

const execPath = path.resolve(__dirname, 'function.js')

module.exports = (
  fn,
  { getBrowserless = requireOneOf(['browserless']), retry = 2, timeout = 30000, ...opts }
) => {
  return async (url, fnOpts = {}) => {
    const browserlessPromise = getBrowserless()
    let isRejected = false
    let subprocess

    async function run () {
      const browserless = await browserlessPromise
      const browser = await browserless.browser()
      const browserWSEndpoint = browser.wsEndpoint()

      subprocess = execa.node(execPath)
      subprocess.stderr.pipe(process.stderr)

      debug('spawn', { pid: subprocess.pid })

      subprocess.send({
        url,
        code: fn.toString(),
        browserWSEndpoint,
        ...opts,
        ...fnOpts
      })

      const { value, reason, isFulfilled } = await pEvent(subprocess, 'message')
      await driver.close(subprocess)
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
      if (subprocess) subprocess.kill('SIGKILL')
      throw browserTimeout({ timeout })
    })

    return result
  }
}

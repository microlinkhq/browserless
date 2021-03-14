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

module.exports = async (
  query,
  { getBrowserless = requireOneOf(['browserless']), retry = 5, timeout = 30000, ...opts } = {}
) => {
  const browserless = getBrowserless()
  let isRejected = false

  async function run () {
    let subprocess

    try {
      const browser = await (await browserless).browser()
      const browserWSEndpoint = browser.wsEndpoint()

      subprocess = execa.node(execPath, { killSignal: 'SIGKILL' })
      subprocess.stderr.pipe(process.stderr)
      subprocess.stdout.pipe(process.stdout)

      debug('spawn', { pid: subprocess.pid })
      subprocess.send({ query, browserWSEndpoint, ...opts })

      const { value, reason, isFulfilled } = await pEvent(subprocess, 'message')
      if (isFulfilled) return value
      throw reason
    } catch (error) {
      throw ensureError(error)
    } finally {
      driver.close(subprocess)
    }
  }

  const task = () =>
    pRetry(run, {
      retry,
      onFailedAttempt: async error => {
        if (error.name === 'AbortError') throw error
        if (isRejected) throw new AbortError()
        Promise.resolve(browserless).then(browserless => browserless.respawn())
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

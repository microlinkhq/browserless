'use strict'

const { ensureError, browserTimeout } = require('@browserless/errors')
const debug = require('debug-logfmt')('browserless:lighthouse')
const { driver } = require('browserless')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')
const pEvent = require('p-event')
const execa = require('execa')
const path = require('path')

const lighthousePath = path.resolve(__dirname, 'lighthouse.js')

const { AbortError } = pRetry

const getConfig = settings => ({ extends: 'lighthouse:default', settings })

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
    retry = 5,
    timeout = 30000,
    ...opts
  } = {}
) => {
  const browserless = getBrowserless()
  const config = getConfig(opts)
  let isRejected = false

  async function run () {
    let subprocess

    try {
      const browser = await (await browserless).browser()
      const flags = await getFlags(browser, { disableStorageReset, logLevel, output })

      subprocess = execa.node(lighthousePath, { killSignal: 'SIGKILL' })
      subprocess.stderr.pipe(process.stderr)
      debug('spawn', { pid: subprocess.pid })
      subprocess.send({ url, flags, config })

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

  const result = await pTimeout(task(), timeout, () => {
    isRejected = true
    throw browserTimeout({ timeout })
  })

  return result
}

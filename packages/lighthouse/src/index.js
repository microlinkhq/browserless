'use strict'

const {
  getError,
  browserDisconnected,
  ensureError,
  browserTimeout
} = require('@browserless/errors')

const debug = require('debug-logfmt')('browserless:lighthouse')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')
const pEvent = require('p-event')
const execa = require('execa')
const path = require('path')

const lighthousePath = path.resolve(__dirname, 'lighthouse.js')

const destroySubprocess = (subprocess, { reason }) => {
  if (!subprocess || subprocess.killed) return
  subprocess.kill('SIGKILL')
  debug('destroy', { pid: subprocess.pid, reason })
}

const getConfig = ({
  onlyCategories = ['performance', 'best-practices', 'accessibility', 'seo'],
  device = 'desktop',
  ...props
}) => ({
  extends: 'lighthouse:default',
  settings: {
    onlyCategories,
    emulatedFormFactor: device,
    ...props
  }
})

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
    retries = 5,
    timeout = 30000,
    ...opts
  } = {}
) => {
  const browserless = getBrowserless()
  const config = getConfig(opts)

  let isRejected = false
  let subprocess

  async function run () {
    try {
      const browser = await (await browserless).browser
      if (!browser.isConnected()) throw browserDisconnected()

      const flags = await getFlags(browser, { disableStorageReset, logLevel, output })

      subprocess = execa.node(lighthousePath, { killSignal: 'SIGKILL' })
      subprocess.stderr.pipe(process.stderr)
      debug('spawn', { pid: subprocess.pid })

      subprocess.send({ url, flags, config })

      const { value, reason, isFulfilled } = await pEvent(subprocess, 'message')
      if (isFulfilled) return value
      throw getError(reason)
    } catch (error) {
      throw ensureError(error)
    }
  }

  const task = () =>
    pRetry(run, {
      retries,
      onFailedAttempt: async error => {
        if (error.name === 'AbortError') throw error
        if (isRejected) throw new pRetry.AbortError()
        destroySubprocess(subprocess, { reason: 'retry' })
        browserless.respawn()
        const { message, attemptNumber, retriesLeft } = error
        debug('retry', { attemptNumber, retriesLeft, message })
      }
    })

  // main
  const result = await pTimeout(task(), timeout, () => {
    isRejected = true
    destroySubprocess(subprocess, { reason: 'timeout' })
    throw browserTimeout({ timeout })
  })

  destroySubprocess(subprocess, { reason: 'done' })

  return result
}

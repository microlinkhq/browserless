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

const getConfig = ({ preset: presetName, ...settings }) => {
  const baseConfig = presetName
    ? require(`lighthouse/lighthouse-core/config/${presetName}-config.js`)
    : { extends: 'lighthouse:default' }

  return { ...baseConfig, settings: { ...baseConfig.settings, ...settings } }
}

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
  const config = getConfig(opts)
  let isRejected = false
  let subprocess

  async function run () {
    const browserless = await browserlessPromise
    const browser = await browserless.browser()
    const flags = await getFlags(browser, { disableStorageReset, logLevel, output })

    subprocess = execa.node(lighthousePath)
    subprocess.stderr.pipe(process.stderr)
    debug('spawn', { pid: subprocess.pid })
    subprocess.send({ url, flags, config })

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

  const result = await pTimeout(task(), timeout, () => {
    isRejected = true
    if (subprocess) subprocess.kill('SIGKILL')
    throw browserTimeout({ timeout })
  })

  return result
}

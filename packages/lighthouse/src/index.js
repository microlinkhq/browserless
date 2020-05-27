'use strict'

const debug = require('debug-logfmt')('browserless:lighthouse')
const { browserTimeout } = require('@browserless/errors')
const requireOneOf = require('require-one-of')
const pTimeout = require('p-timeout')
const pRetry = require('p-retry')
const pEvent = require('p-event')
const execa = require('execa')
const path = require('path')

const lighthousePath = path.resolve(__dirname, 'lighthouse.js')

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
    getBrowserless = requireOneOf(['browserless']),
    logLevel,
    output,
    retries = 5,
    timeout = 30000,
    ...opts
  }
) => {
  const browserless = await getBrowserless()
  const browser = await browserless.browser
  let isRejected = false

  const flags = await getFlags(browser, { disableStorageReset, logLevel, output })
  const config = getConfig(opts)
  let subprocess

  const destroy = () => {
    debug('destroy', { pid: subprocess.pid })
    subprocess.kill()
  }

  const run = () => {
    subprocess = execa.node(lighthousePath)
    subprocess.stderr.pipe(process.stderr)
    debug('run', { pid: subprocess.pid })
    subprocess.send({ url, flags, config })
    return pEvent(subprocess, 'message')
  }

  const task = () =>
    pRetry(run, {
      retries,
      onFailedAttempt: async error => {
        if (isRejected) throw new pRetry.AbortError()
        const { message, attemptNumber, retriesLeft } = error
        debug('retry', { attemptNumber, retriesLeft, message })
        destroy()
        await browserless.respawn()
      }
    })

  const result = await pTimeout(task(), timeout, async () => {
    isRejected = true
    destroy()
    throw browserTimeout({ timeout })
  })

  destroy()

  return result
}

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

const getLighthouseConfiguration = ({
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
const getOptions = (browser, { logLevel, output }) => ({
  port: new URL(browser.wsEndpoint()).port,
  output,
  logLevel
})

module.exports = async (
  url,
  {
    getBrowserless = requireOneOf(['browserless']),
    logLevel = 'error',
    output = 'json',
    timeout = 30000,
    retries = 5,
    ...opts
  }
) => {
  const browserless = await getBrowserless()
  const browser = await browserless.browser
  let isRejected = false

  const lighthouseOpts = await getOptions(browser, { logLevel, output })
  const lighthouseConfig = getLighthouseConfiguration(opts)

  const run = () => {
    const subprocess = execa.node(lighthousePath)
    subprocess.send({ url, opts: lighthouseOpts, config: lighthouseConfig })
    return pEvent(subprocess, 'message')
  }

  const task = () =>
    pRetry(run, {
      retries,
      onFailedAttempt: async error => {
        if (isRejected) throw new pRetry.AbortError()
        const { message, attemptNumber, retriesLeft } = error
        debug('retry', { attemptNumber, retriesLeft, message })
        await browserless.respawn()
      }
    })

  const result = await pTimeout(task(), timeout, async () => {
    isRejected = true
    throw browserTimeout({ timeout })
  })

  return result
}

'use strict'

const debug = require('debug-logfmt')('browserless:error')
const { serializeError } = require('serialize-error')
const whoops = require('whoops')

const ERROR_NAME = 'BrowserlessError'

const createBrowserlessError = opts => whoops(ERROR_NAME, opts)

const browserlessError = {}

browserlessError.browserTimeout = createBrowserlessError({
  code: 'EBRWSRTIMEOUT',
  message: ({ timeout }) => `Promise timed out after ${timeout} milliseconds`
})

browserlessError.protocolError = createBrowserlessError({ code: 'EPROTOCOL' })

browserlessError.evaluationFailed = createBrowserlessError({
  code: 'EFAILEDEVAL',
  message: 'Evaluation failed'
})

browserlessError.browserDisconnected = createBrowserlessError({
  code: 'EBRWSRCONNRESET',
  message: 'The browser is not connected.'
})

browserlessError.contextDisconnected = createBrowserlessError({
  code: 'EBRWSRCONTEXTCONNRESET',
  message: 'The browser context is not connected.'
})

browserlessError.ensureError = rawError => {
  debug('ensureError', serializeError(rawError))

  const error = 'error' in rawError ? rawError.error : rawError

  if (error.code === 'ECONNREFUSED') {
    return browserlessError.browserDisconnected()
  }

  const { message: errorMessage = '' } = error

  if (errorMessage === 'Protocol error (Target.createTarget): browserContextId') {
    return browserlessError.contextDisconnected()
  }

  if (errorMessage.startsWith('Protocol error')) {
    return browserlessError.protocolError({
      message: errorMessage.split(': ')[1]
    })
  }

  if (errorMessage.startsWith('Evaluation failed')) {
    const messages = errorMessage.split(': ')
    return browserlessError.evaluationFailed({
      message: messages[messages.length - 1]
    })
  }

  return require('ensure-error')(error)
}

module.exports = browserlessError

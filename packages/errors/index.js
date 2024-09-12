'use strict'

const debug = require('debug-logfmt')('browserless:error')
const { serializeError } = require('serialize-error')
const whoops = require('whoops')

const ERROR_NAME = 'BrowserlessError'

const createErrorFactory = opts => whoops(ERROR_NAME, opts)

const markAsProcessed = error => {
  Object.defineProperty(error, '__parsed', {
    value: true,
    writable: false,
    enumerable: false,
    configurable: false
  })
  return error
}

const createBrowserlessError = opts => {
  const createError = createErrorFactory(opts)
  return (...args) => markAsProcessed(createError(...args))
}

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

browserlessError.contextDisconnected = createBrowserlessError({
  code: 'EBRWSRCONTEXTCONNRESET',
  message: 'The browser context is not connected.'
})

browserlessError.ensureError = rawError => {
  if (rawError.__parsed) return rawError

  debug('ensureError', serializeError(rawError))

  const error = 'error' in rawError ? rawError.error : rawError

  const { message: errorMessage = '' } = error

  if (
    [
      'Protocol error (Target.createTarget): Failed to find browser context with id',
      'Protocol error (Target.createTarget): Target closed',
      'Protocol error (Target.createBrowserContext): Target closed'
    ].some(message => errorMessage.startsWith(message))
  ) {
    return browserlessError.contextDisconnected()
  }

  if (errorMessage.startsWith('Protocol error')) {
    return browserlessError.protocolError({
      message: errorMessage.split(': ')[1]
    })
  }

  if (
    ['Evaluation failed', 'Cannot read properties of undefined'].some(message =>
      errorMessage.startsWith(message)
    ) ||
    errorMessage.endsWith('is not defined')
  ) {
    const messages = errorMessage.split(': ')
    return browserlessError.evaluationFailed({
      message: messages[messages.length - 1]
    })
  }

  return require('ensure-error')(error)
}

const isBrowserlessError = error => error.name === ERROR_NAME

module.exports = browserlessError
module.exports.isBrowserlessError = isBrowserlessError

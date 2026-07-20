'use strict'

const debug = require('debug-logfmt')('browserless:error')
const { serializeError } = require('serialize-error')
const ensureError = require('ensure-error')
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

const isObject = value => value !== null && typeof value === 'object'

const browserlessError = {}

browserlessError.browserTimeout = createBrowserlessError({
  code: 'EBRWSRTIMEOUT',
  message: ({ timeout }) => `Promise timed out after ${timeout} milliseconds`
})

browserlessError.protocolError = createBrowserlessError({ code: 'EPROTOCOL' })

browserlessError.evaluationFailed = createBrowserlessError({
  code: 'EINVALEVAL',
  message: 'Evaluation failed'
})

browserlessError.contextDisconnected = createBrowserlessError({
  code: 'EBRWSRCONTEXTCONNRESET',
  message: 'The browser context is not connected.'
})

const getErrorMessage = rawError => {
  const error = isObject(rawError) && 'error' in rawError ? rawError.error : rawError
  if (typeof error === 'string') return error
  return isObject(error) && typeof error.message === 'string' ? error.message : ''
}

// Whether the error means the page's frame was not in a usable state for the
// operation — torn down mid-flight (a client-side navigation), or not yet
// attached. Both are transient on SPAs that navigate after load: waiting for
// navigation to settle and retrying the operation in-place typically succeeds.
const isContextDestroyed = rawError => {
  const errorMessage = getErrorMessage(rawError)
  return (
    [
      'Protocol error (Target.createTarget): Failed to find browser context with id',
      'Protocol error (Target.createTarget): Target closed',
      'Protocol error (Target.createBrowserContext): Target closed'
    ].some(message => errorMessage.startsWith(message)) ||
    errorMessage.includes('Session closed') ||
    errorMessage.includes('Attempted to use detached Frame') ||
    // Chrome's other phrasing of a frame detaching mid-operation (a navigation
    // committed while an evaluate/print targeting the old frame was in flight).
    errorMessage.includes('Execution context is not available in detached frame') ||
    errorMessage.includes('Execution context was destroyed') ||
    // The inverse race: an operation ran before the page's main frame attached.
    // The frame arrives once navigation commits, so a settle-and-retry resolves
    // it; a page that never navigates falls through when the retry budget ends.
    errorMessage.includes('Requesting main frame too early')
  )
}

browserlessError.ensureError = rawError => {
  if (isObject(rawError) && rawError.__parsed) return rawError

  debug('ensureError', serializeError(rawError))

  const error = isObject(rawError) && 'error' in rawError ? rawError.error : rawError

  const errorMessage = isObject(error) && typeof error.message === 'string' ? error.message : ''

  if (isContextDestroyed(error)) {
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

  return ensureError(error)
}

const isBrowserlessError = error => error.name === ERROR_NAME

module.exports = browserlessError
module.exports.isBrowserlessError = isBrowserlessError
module.exports.isContextDestroyed = isContextDestroyed

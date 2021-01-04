'use strict'

const whoops = require('whoops')

const ERROR_NAME = 'BrowserlessError'

const createBrowserlessError = opts => whoops(ERROR_NAME, opts)

const error = {}

error.browserTimeout = createBrowserlessError({
  code: 'EBRWSRTIMEOUT',
  message: ({ timeout }) => `Promise timed out after ${timeout} milliseconds`
})

error.protocolError = createBrowserlessError({ code: 'EPROTOCOL' })

error.evaluationFailed = createBrowserlessError({
  code: 'EFAILEDEVAL',
  message: 'Evaluation failed'
})

error.ensureError = error => ('error' in error ? error.error : error)

error.browserDisconnected = createBrowserlessError({
  code: 'EBRWSRCONNRESET',
  message: 'The browser is not connected.'
})

error.getError = ({ code, message = '', ...rawError }) => {
  if (code === 'ECONNREFUSED') return error.browserDisconnected(rawError)

  if (message.startsWith('Protocol error')) {
    return error.protocolError({
      message: message.split(': ')[1]
    })
  }

  if (message.startsWith('Evaluation failed')) {
    const messages = message.split(': ')
    return error.evaluationFailed({
      message: messages[messages.length - 1]
    })
  }

  return rawError
}

module.exports = error

'use strict'

const whoops = require('whoops')

const ERROR_NAME = 'BrowserlessError'

const createBrowserlessError = opts => whoops(ERROR_NAME, opts)

const error = message => {
  if (message.startsWith('Protocol error')) {
    return error.protocolError({
      message: message.split(': ')[1]
    })
  }
}

error.browserTimeout = createBrowserlessError({
  code: 'EBRWSRTIMEOUT',
  message: ({ timeout }) => `Promise timed out after ${timeout} milliseconds`
})

error.protocolError = createBrowserlessError({ code: 'EPROTOCOL' })

module.exports = error

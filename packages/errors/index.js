'use strict'

const whoops = require('whoops')

const ERROR_NAME = 'BrowserlessError'

const createBrowserlessError = opts => whoops(ERROR_NAME, opts)

const browserTimeout = createBrowserlessError({
  code: 'EBRWSRTIMEOUT',
  message: ({ timeout }) => `Promise timed out after ${timeout} milliseconds`
})

const protocolError = whoops(ERROR_NAME, { code: 'EPROTOCOL' })

const parse = message => {
  if (message.startsWith('Protocol error')) {
    return protocolError({
      message: message.split(': ')[1]
    })
  }
}

module.exports.browserTimeout = browserTimeout
module.exports.protocolError = protocolError
module.exports = parse

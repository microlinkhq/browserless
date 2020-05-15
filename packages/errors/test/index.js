'use strict'

const test = require('ava')
const parse = require('..')

test('protocolError', t => {
  const message = 'Protocol error (Runtime.callFunctionOn): Target closed.'
  const error = parse(message)

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EPROTOCOL')
  t.is(error.message, 'EPROTOCOL, Target closed.')
})

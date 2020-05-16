'use strict'

const test = require('ava')
const createError = require('..')

test('protocolError', t => {
  const parsedError = createError('Protocol error (Runtime.callFunctionOn): Target closed.')
  t.true(parsedError instanceof Error)
  t.is(parsedError.name, 'BrowserlessError')
  t.is(parsedError.code, 'EPROTOCOL')
  t.is(parsedError.message, 'EPROTOCOL, Target closed.')

  const error = createError.protocolError('Target closed.')
  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EPROTOCOL')
  t.is(error.message, 'EPROTOCOL, Target closed.')
})

test('browserTimeout', t => {
  const error = createError.browserTimeout({ timeout: 50 })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRTIMEOUT')
  t.is(error.message, 'EBRWSRTIMEOUT, Promise timed out after 50 milliseconds')
})

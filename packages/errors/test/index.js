'use strict'

const test = require('ava')
const errors = require('..')

test('protocolError', t => {
  const parsedError = errors.ensureError({
    message: 'Protocol error (Runtime.callFunctionOn): Target closed.'
  })

  t.true(parsedError instanceof Error)
  t.is(parsedError.name, 'BrowserlessError')
  t.is(parsedError.code, 'EPROTOCOL')
  t.is(parsedError.message, 'EPROTOCOL, Target closed.')

  const error = errors.protocolError({ message: 'Target closed.' })
  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EPROTOCOL')
  t.is(error.message, 'EPROTOCOL, Target closed.')
})

test('browserDisconnected', t => {
  const parsedError = errors.ensureError({ code: 'ECONNREFUSED' })

  t.true(parsedError instanceof Error)
  t.is(parsedError.name, 'BrowserlessError')
  t.is(parsedError.code, 'EBRWSRCONNRESET')
  t.is(parsedError.message, 'EBRWSRCONNRESET, The browser is not connected.')

  const error = errors.browserDisconnected()
  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(parsedError.code, 'EBRWSRCONNRESET')
  t.is(parsedError.message, 'EBRWSRCONNRESET, The browser is not connected.')
})

test('browserTimeout', t => {
  const error = errors.browserTimeout({ timeout: 50 })

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EBRWSRTIMEOUT')
  t.is(error.message, 'EBRWSRTIMEOUT, Promise timed out after 50 milliseconds')
})

test('evaluationFailed', t => {
  const parsedError = errors.ensureError({
    message: "Evaluation failed: TypeError: Cannot read property 'bar' of undefined"
  })

  t.true(parsedError instanceof Error)
  t.is(parsedError.name, 'BrowserlessError')
  t.is(parsedError.code, 'EFAILEDEVAL')
  t.is(parsedError.message, "EFAILEDEVAL, Cannot read property 'bar' of undefined")

  const error = errors.evaluationFailed("Cannot read property 'bar' of undefined")

  t.true(error instanceof Error)
  t.is(error.name, 'BrowserlessError')
  t.is(error.code, 'EFAILEDEVAL')
  t.is(error.message, "EFAILEDEVAL, Cannot read property 'bar' of undefined")
})

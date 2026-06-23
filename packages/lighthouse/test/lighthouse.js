'use strict'

const test = require('ava')

const { isPerfMarkError } = require('../src/lighthouse')
const errors = require('@browserless/errors')

test('isPerfMarkError detects marky teardown errors', t => {
  const error = new SyntaxError('The "start lh:runner:gather" performance mark has not been set')
  t.true(isPerfMarkError(error))
})

test('isPerfMarkError ignores unrelated errors', t => {
  t.false(isPerfMarkError(new Error('boom')))
  t.false(isPerfMarkError(undefined))
  t.false(isPerfMarkError({}))
})

test('contextDisconnected is retryable by withPage', t => {
  // the error perf-mark failures are mapped to must carry the code withPage's
  // pRetry treats as retryable, so the context is recreated and the run retried
  const error = errors.contextDisconnected()
  t.is(error.code, 'EBRWSRCONTEXTCONNRESET')
})

'use strict'

const test = require('ava')

const { clampTimeout, globToRegExp } = require('../../../src/actions/handlers')

test('clampTimeout keeps budget when unset', t => {
  t.is(clampTimeout(undefined, 5000), 5000)
  t.is(clampTimeout(null, 5000), 5000)
})

test('clampTimeout parses humanized durations', t => {
  t.is(clampTimeout('3s', 10000), 3000)
  t.is(clampTimeout('500ms', 10000), 500)
  t.is(clampTimeout(2000, 10000), 2000)
})

test('clampTimeout never exceeds budget', t => {
  t.is(clampTimeout('30s', 1000), 1000)
  t.is(clampTimeout(5000, 1000), 1000)
})

test('clampTimeout falls back to budget on invalid input', t => {
  t.is(clampTimeout('nope', 1000), 1000)
  t.is(clampTimeout(-1, 1000), 1000)
})

test('globToRegExp matches request patterns', t => {
  const re = globToRegExp('*api.example.com/user*')
  t.true(re.test('https://api.example.com/user/1'))
  t.false(re.test('https://other.example.com/user/1'))
})

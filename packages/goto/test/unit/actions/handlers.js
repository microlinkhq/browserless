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

test('globToRegExp treats ? as a literal', t => {
  const re = globToRegExp('*/user?id=*')
  t.true(re.test('https://api.example.com/user?id=1'))
  t.false(re.test('https://api.example.com/useid=1'))
})

test('globToRegExp escapes regex metacharacters', t => {
  const re = globToRegExp('https://example.com/a+b(c)')
  t.true(re.test('https://example.com/a+b(c)'))
  t.false(re.test('https://example.com/aab(c)'))
})

test('globToRegExp rejects over-long patterns', t => {
  t.throws(() => globToRegExp('*'.repeat(513)), {
    message: /pattern exceeds 512 characters/
  })
})

test('globToRegExp matches a crafted backtracking pattern in linear time', t => {
  const re = globToRegExp(`${'*a'.repeat(20)}z`)
  const input = `${'a'.repeat(80)}y`
  const started = Date.now()
  t.false(re.test(input))
  t.true(Date.now() - started < 50)
})

'use strict'

const test = require('ava')

const { parseCookies } = require('../../../src')

test('parse cookies from string with `; ` delimiter', t => {
  const url = 'https://example.com'
  const cookiesStr = 'foo=bar; hello=world'

  const cookies = parseCookies(url, cookiesStr)

  t.true(cookies.every(cookie => !!cookie.value))
  t.true(cookies.every(cookie => !!cookie.domain))
  t.true(cookies.every(cookie => !!cookie.path))
  t.true(cookies.every(cookie => !!cookie.name))
})

test('parse cookies from string with `;` delimiter', t => {
  const url = 'https://example.com'
  const cookiesStr = 'foo=bar;hello=world'

  const cookies = parseCookies(url, cookiesStr)

  t.true(cookies.every(cookie => !!cookie.value))
  t.true(cookies.every(cookie => !!cookie.domain))
  t.true(cookies.every(cookie => !!cookie.path))
  t.true(cookies.every(cookie => !!cookie.name))
})

test('works fine with subdomains', t => {
  const url = 'https://this.is.an.example.com'
  const cookiesStr = 'foo=bar;hello=world'

  const cookies = parseCookies(url, cookiesStr)

  t.true(cookies.every(cookie => cookie.domain === 'this.is.an.example.com'))
})

'use strict'

const test = require('ava')

const { parseCookies } = require('../../src')

test('parse cookies from string with `; ` delimiter', t => {
  const url = 'https://example.com'
  const cookiesStr = 'foo=bar; hello=world'

  const cookies = parseCookies(url, cookiesStr)

  t.deepEqual(cookies, [
    {
      name: 'foo',
      value: 'bar',
      domain: '.example.com',
      url: 'https://example.com',
      path: '/'
    },
    {
      name: 'hello',
      value: 'world',
      domain: '.example.com',
      url: 'https://example.com',
      path: '/'
    }
  ])
})

test('parse cookies from string with `;` delimiter', t => {
  const url = 'https://example.com'
  const cookiesStr = 'foo=bar; hello=world'

  const cookies = parseCookies(url, cookiesStr)

  t.deepEqual(cookies, [
    {
      name: 'foo',
      value: 'bar',
      domain: '.example.com',
      url: 'https://example.com',
      path: '/'
    },
    {
      name: 'hello',
      value: 'world',
      domain: '.example.com',
      url: 'https://example.com',
      path: '/'
    }
  ])
})

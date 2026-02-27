'use strict'

const { spawnSync } = require('child_process')
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

test('skips cookie jar allocations in the fast-path', t => {
  const parseCookiesPath = require.resolve('../../../src')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    let cookieJarCount = 0

    Module._load = function (request, parent, isMain) {
      if (request === 'tough-cookie') {
        const mod = originalLoad(request, parent, isMain)
        class CookieJar extends mod.CookieJar {
          constructor (...args) {
            super(...args)
            cookieJarCount += 1
          }
        }
        return { ...mod, CookieJar }
      }
      return originalLoad(request, parent, isMain)
    }

    const { parseCookies } = require(${JSON.stringify(parseCookiesPath)})
    parseCookies('https://example.com', 'foo=bar;hello=world;one=more')
    process.stdout.write(String(cookieJarCount))
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.is(stdout.trim(), '0')
})

test('falls back to tough-cookie for invalid tokens', t => {
  const parseCookiesPath = require.resolve('../../../src')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    let cookieJarCount = 0

    Module._load = function (request, parent, isMain) {
      if (request === 'tough-cookie') {
        const mod = originalLoad(request, parent, isMain)
        class CookieJar extends mod.CookieJar {
          constructor (...args) {
            super(...args)
            cookieJarCount += 1
          }
        }
        return { ...mod, CookieJar }
      }
      return originalLoad(request, parent, isMain)
    }

    const { parseCookies } = require(${JSON.stringify(parseCookiesPath)})

    try {
      parseCookies('https://example.com', 'foo=bar;')
    } catch {}

    process.stdout.write(String(cookieJarCount))
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.is(stdout.trim(), '1')
})

test('preserves default cookie path resolution', t => {
  const cookies = parseCookies('https://example.com/foo/bar', 'foo=bar;hello=world')

  t.true(cookies.every(cookie => cookie.path === '/foo'))
})

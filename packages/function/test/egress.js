'use strict'

const { default: test } = require('ava')

const createRunFunction = require('../src/function')

const run = opts => {
  let seen
  const fake = (program, options) => {
    seen = options
    return async () => ({ isFulfilled: true, value: null, profiling: { phases: {} } })
  }
  return createRunFunction(fake)({
    url: 'https://example.com',
    code: '() => 1',
    needsNetwork: false,
    vmOpts: { ssrf: () => false },
    ...opts
  }).then(() => seen)
}

test('the browser socket is allowed and every other dial follows the policy', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://127.0.0.1:43123/token' })
  t.true(ssrf('127.0.0.1', 43123))
  t.false(ssrf('127.0.0.1', 1))
  t.false(ssrf('10.0.0.1', 80))
})

test('an IPv6 browser socket is allowed on that port only', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://[::1]:9/token' })
  t.true(ssrf('::1', 9))
  t.false(ssrf('::1', 1))
})

test('an explicit default websocket port is still allowed', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://127.0.0.1:80/token' })
  t.true(ssrf('127.0.0.1', 80))
  t.false(ssrf('127.0.0.1', 1))
})

test('a leading-zero default port is the port that is dialed', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://127.0.0.1:080/token' })
  t.true(ssrf('127.0.0.1', 80))
  t.false(ssrf('127.0.0.1', 8))
})

test('an explicit default secure websocket port is still allowed', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'wss://127.0.0.1:443/token' })
  t.true(ssrf('127.0.0.1', 443))
})

test('an explicit default IPv6 port is still allowed', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'wss://[::1]:443/token' })
  t.true(ssrf('::1', 443))
  t.false(ssrf('::1', 9))
})

test('an address with no port is not allowed', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://127.0.0.1/token' })
  t.false(ssrf('127.0.0.1', 80))
})

test('an IPv6 address with no port is not allowed', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://[::1]/token' })
  t.false(ssrf('::1', 80))
})

test('a run with no browser socket grants nothing on its own', async t => {
  const { ssrf } = await run({})
  t.false(ssrf('127.0.0.1', 43123))
})

test('a hostname endpoint is not granted', async t => {
  const { ssrf } = await run({ browserWSEndpoint: 'ws://browser.internal:9/token' })
  t.false(ssrf('127.0.0.1', 9))
  t.false(ssrf('browser.internal', 9))
})

test('the caller policy is kept and the browser socket is added', async t => {
  const { ssrf } = await run({
    browserWSEndpoint: 'ws://127.0.0.1:43123/token',
    vmOpts: { ssrf: address => address === '1.1.1.1' }
  })
  t.true(ssrf('1.1.1.1', 443))
  t.true(ssrf('127.0.0.1', 43123))
  t.false(ssrf('10.0.0.1', 80))
})

test('without a policy the isolate dials stay unrestricted', async t => {
  const options = await run({
    browserWSEndpoint: 'ws://127.0.0.1:43123/token',
    vmOpts: {}
  })
  t.is(options.ssrf, undefined)
})

'use strict'

const { default: test } = require('ava')

const createRunFunction = require('../src/function')

const run = (opts, isolated) => {
  let allow
  const fake = (program, options) => {
    allow = options.allow
    return async () => ({ isFulfilled: true, value: null, profiling: { phases: {} } })
  }
  return createRunFunction(isolated || fake)({
    url: 'https://example.com',
    code: '() => 1',
    needsNetwork: false,
    ...opts
  }).then(() => allow)
}

test('the browser socket is the only reserved dial granted to the isolate', async t => {
  const allow = await run({ browserWSEndpoint: 'ws://127.0.0.1:43123/token' })
  t.deepEqual(allow.egress, ['127.0.0.1:43123'])
})

test('an IPv6 browser socket keeps its brackets', async t => {
  const allow = await run({ browserWSEndpoint: 'ws://[::1]:9/token' })
  t.deepEqual(allow.egress, ['[::1]:9'])
})

test('an explicit default websocket port is still granted', async t => {
  const allow = await run({ browserWSEndpoint: 'ws://127.0.0.1:80/token' })
  t.deepEqual(allow.egress, ['127.0.0.1:80'])
})

test('an explicit default secure websocket port is still granted', async t => {
  const allow = await run({ browserWSEndpoint: 'wss://127.0.0.1:443/token' })
  t.deepEqual(allow.egress, ['127.0.0.1:443'])
})

test('an explicit default IPv6 port keeps its brackets', async t => {
  const allow = await run({ browserWSEndpoint: 'wss://[::1]:443/token' })
  t.deepEqual(allow.egress, ['[::1]:443'])
})

test('an address with no port is not granted', async t => {
  const allow = await run({ browserWSEndpoint: 'ws://127.0.0.1/token' })
  t.deepEqual(allow.egress, [])
})

test('a run with no browser socket grants no reserved dial', async t => {
  const allow = await run({})
  t.deepEqual(allow.egress, [])
})

test('a hostname endpoint is not granted', async t => {
  const allow = await run({ browserWSEndpoint: 'ws://browser.internal:9/token' })
  t.deepEqual(allow.egress, [])
})

test('caller egress is kept and the browser socket is added', async t => {
  const allow = await run({
    browserWSEndpoint: 'ws://127.0.0.1:43123/token',
    vmOpts: { allow: { egress: ['10.0.0.1:80'] } }
  })
  t.deepEqual(allow.egress, ['10.0.0.1:80', '127.0.0.1:43123'])
})

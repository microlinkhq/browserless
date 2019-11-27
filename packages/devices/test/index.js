'use strict'

const test = require('ava')

const getDevice = require('..')()

test('undefined as default', t => {
  t.deepEqual(getDevice(), {
    userAgent: undefined,
    viewport: undefined
  })
})

test('support user agent from headers', t => {
  t.deepEqual(getDevice({ headers: { 'user-agent': 'googlebot' } }), {
    userAgent: 'googlebot',
    viewport: undefined
  })
})

test('unify user agent from device', t => {
  const device = getDevice({ device: 'iPad' })

  t.deepEqual(getDevice({ device: 'iPad', headers: { 'user-agent': 'googlebot' } }), {
    userAgent: device.userAgent,
    viewport: device.viewport
  })
})

test('case insensitive device support', t => {
  const one = getDevice({ device: 'macbook pro 13' })
  const two = getDevice({ device: 'Macbook Pro 13' })

  t.true(typeof one === 'object')
  t.true(typeof two === 'object')
  t.deepEqual(one, two)
})

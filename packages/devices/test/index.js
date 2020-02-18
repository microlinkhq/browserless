'use strict'

const test = require('ava')

const createGetDevice = require('..')

test('undefined as default', t => {
  const getDevice = createGetDevice()

  t.deepEqual(getDevice(), {
    userAgent: undefined,
    viewport: undefined
  })
})

test('support user agent from headers', t => {
  const getDevice = createGetDevice()

  t.deepEqual(getDevice({ headers: { 'user-agent': 'googlebot' } }), {
    userAgent: 'googlebot',
    viewport: undefined
  })
})

test('unify user agent from device', t => {
  const getDevice = createGetDevice()
  const device = getDevice({ device: 'iPad' })

  t.deepEqual(getDevice({ device: 'iPad', headers: { 'user-agent': 'googlebot' } }), {
    userAgent: device.userAgent,
    viewport: device.viewport
  })
})

test('support lossy device name', t => {
  const getDevice = createGetDevice({ lossyDeviceName: true })
  const device = getDevice({ device: 'Macbook Pro 13' })

  t.deepEqual(getDevice({ device: 'macbook pro 13' }), device)
  t.deepEqual(getDevice({ device: 'MACBOOK PRO 13' }), device)
  t.deepEqual(getDevice({ device: 'macbook pro' }), device)
  t.deepEqual(getDevice({ device: 'macboo pro' }), device)
})

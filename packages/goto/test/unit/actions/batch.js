'use strict'

const test = require('ava')

const { batchActions, batchKey } = require('../../../src/actions/batch')

test('batchKey marks inject and capture groups', t => {
  t.is(batchKey('inject'), 'inject')
  t.is(batchKey('screenshot'), 'capture')
  t.is(batchKey('pdf'), 'capture')
  t.is(batchKey('click'), null)
  t.is(batchKey('wait'), null)
})

test('batchActions groups consecutive injects', t => {
  const waves = batchActions([
    { type: 'inject', styles: ['a'] },
    { type: 'inject', modules: ['b'] },
    { type: 'click', selector: '#x' }
  ])
  t.is(waves.length, 2)
  t.is(waves[0].key, 'inject')
  t.is(waves[0].actions.length, 2)
  t.is(waves[0].startIndex, 0)
  t.is(waves[1].key, null)
  t.is(waves[1].actions[0].type, 'click')
})

test('batchActions groups consecutive screenshot + pdf', t => {
  const waves = batchActions([
    { type: 'wait', timeout: 1 },
    { type: 'screenshot', fullPage: true },
    { type: 'pdf', format: 'A4' }
  ])
  t.is(waves.length, 2)
  t.is(waves[1].key, 'capture')
  t.is(waves[1].actions.length, 2)
  t.is(waves[1].startIndex, 1)
})

test('batchActions treats barriers as singleton waves', t => {
  const waves = batchActions([
    { type: 'click', selector: '#a' },
    { type: 'fill', selector: '#b', value: 'x' },
    { type: 'wait', timeout: 10 }
  ])
  t.is(waves.length, 3)
  t.true(waves.every(wave => wave.key === null && wave.actions.length === 1))
})

'use strict'

const pReflect = require('p-reflect')
const pTimeout = require('p-timeout')
const test = require('ava')

const { runActions, waitMode } = require('../../../src/actions')

const run = async ({ fn, timeout }) => pReflect(timeout ? pTimeout(fn, timeout) : fn)

const createPage = () => {
  const listeners = { response: [] }
  const pending = []

  return {
    listeners,
    emitResponse: url => {
      const response = { url: () => url }
      listeners.response.forEach(fn => fn(response))
      for (const { match, resolve } of pending.splice(0)) {
        if (match(response)) resolve(response)
        else pending.push({ match, resolve })
      }
    },
    on: (event, fn) => listeners[event].push(fn),
    off: (event, fn) => {
      listeners[event] = listeners[event].filter(listener => listener !== fn)
    },
    waitForResponse: match => new Promise(resolve => pending.push({ match, resolve }))
  }
}

test('waitMode classifies every wait target', t => {
  t.is(waitMode({ type: 'wait', selector: '#a' }), 'element')
  t.is(waitMode({ type: 'wait', role: 'button' }), 'element')
  t.is(waitMode({ type: 'wait', text: 'Done' }), 'text')
  t.is(waitMode({ type: 'wait', request: '*/api/*' }), 'request')
  t.is(waitMode({ type: 'wait', timeout: '1s' }), 'timeout')
  t.is(waitMode({ type: 'wait' }), 'unknown')
})

test('runActions rejects an unknown action type', async t => {
  const page = createPage()
  await t.throwsAsync(runActions(page, [{ type: 'teleport' }], { run, timeout: 1000 }), {
    message: 'actions[0]: unknown type "teleport"'
  })
})

test('runActions detaches the response listener when an action throws', async t => {
  const page = createPage()
  await t.throwsAsync(runActions(page, [{ type: 'teleport' }], { run, timeout: 1000 }))
  t.is(page.listeners.response.length, 0)
})

test('runActions consumes a buffered response only once', async t => {
  const page = createPage()
  const actions = [
    { type: 'wait', request: '*/api/*', timeout: 50 },
    { type: 'wait', request: '*/api/*', timeout: 50 }
  ]

  const promise = runActions(page, actions, { run, timeout: 1000 })
  page.emitResponse('https://example.com/api/one')

  await t.throwsAsync(promise, {
    message: /^actions\[1\] \(wait:request\) failed:/
  })
})

test('runActions bounds the response buffer', async t => {
  const page = createPage()
  const promise = runActions(page, [{ type: 'wait', request: '*/first*', timeout: 50 }], {
    run,
    timeout: 1000
  })

  for (let i = 0; i < 150; i++) page.emitResponse(`https://example.com/${i}`)
  t.is(page.listeners.response.length, 1)

  await t.throwsAsync(promise)
})

test('runActions refuses to run an action on an exhausted budget', async t => {
  const page = createPage()
  const actions = [
    { type: 'wait', timeout: '10s' },
    { type: 'wait', timeout: '10s' }
  ]

  await t.throwsAsync(runActions(page, actions, { run, timeout: 0 }), {
    message: 'actions[0] (wait:timeout): budget exhausted'
  })
})

test('runActions shares one deadline across the whole list', async t => {
  const page = createPage()
  const actions = [
    { type: 'wait', timeout: '10s' },
    { type: 'wait', timeout: '10s' }
  ]

  const startedAt = Date.now()
  await t.throwsAsync(runActions(page, actions, { run, timeout: 200 }), {
    message: 'actions[1] (wait:timeout): budget exhausted'
  })
  t.true(Date.now() - startedAt < 400)
})

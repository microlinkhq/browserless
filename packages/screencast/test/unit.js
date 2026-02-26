'use strict'

const { EventEmitter } = require('events')
const test = require('ava')

const createScreencast = require('..')

test('it does not throw if frame arrives before onFrame is set', async t => {
  const cdp = new EventEmitter()
  const calls = []

  cdp.send = async (method, payload) => {
    calls.push({ method, payload })
  }

  const page = {
    _client: () => cdp
  }

  const screencast = createScreencast(page, {})

  t.notThrows(() => {
    cdp.emit('Page.screencastFrame', {
      data: 'frame',
      metadata: { timestamp: 1 },
      sessionId: 42
    })
  })

  await Promise.resolve()
  t.true(calls.some(({ method }) => method === 'Page.screencastFrameAck'))

  let frameCalls = 0
  screencast.onFrame(() => {
    frameCalls += 1
  })

  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { timestamp: 2 },
    sessionId: 43
  })

  t.is(frameCalls, 1)
})

test('stop removes screencast listener and is idempotent', async t => {
  const cdp = new EventEmitter()
  const calls = []

  cdp.send = async (method, payload) => {
    calls.push({ method, payload })
  }

  const page = {
    _client: () => cdp
  }

  const screencast = createScreencast(page, {})
  t.is(cdp.listenerCount('Page.screencastFrame'), 1)

  await screencast.stop()
  t.is(cdp.listenerCount('Page.screencastFrame'), 0)

  await screencast.stop()
  t.is(cdp.listenerCount('Page.screencastFrame'), 0)

  t.is(calls.filter(({ method }) => method === 'Page.stopScreencast').length, 1)
})

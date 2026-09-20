'use strict'

const test = require('ava')

const networkIdle = require('../../src/network-idle')

const createPage = () => {
  const listeners = new Map()
  return {
    on (event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set())
      listeners.get(event).add(handler)
      return this
    },
    off (event, handler) {
      listeners.get(event)?.delete(handler)
      return this
    },
    emit (event) {
      for (const handler of listeners.get(event) ?? []) handler()
    },
    listenerCount (event) {
      return listeners.get(event)?.size ?? 0
    }
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('an untracked page is credited nothing, so the full window is waited', t => {
  t.is(networkIdle.quietFor({}), 0)
  t.is(networkIdle.quietFor(undefined), 0)
})

test('a page with no puppeteer event emitter is not tracked', t => {
  t.is(networkIdle.track({}, { concurrency: 2 }), undefined)
})

test('a quiet page accrues credit from the moment it is tracked', async t => {
  const page = createPage()
  networkIdle.track(page, { concurrency: 2 })

  await wait(60)

  t.true(networkIdle.quietFor(page) >= 50)
})

test('traffic within the concurrency allowance does not reset the credit', async t => {
  const page = createPage()
  networkIdle.track(page, { concurrency: 2 })

  await wait(60)
  page.emit('request')
  page.emit('request')

  t.true(networkIdle.quietFor(page) >= 50)
})

test('exceeding the concurrency allowance resets the credit to zero', async t => {
  const page = createPage()
  networkIdle.track(page, { concurrency: 2 })

  await wait(60)
  page.emit('request')
  page.emit('request')
  page.emit('request')

  t.is(networkIdle.quietFor(page), 0)
})

test('credit restarts once the page drops back to the allowance', async t => {
  const page = createPage()
  networkIdle.track(page, { concurrency: 2 })

  for (let i = 0; i < 4; i++) page.emit('request')
  t.is(networkIdle.quietFor(page), 0)

  page.emit('requestfinished')
  page.emit('requestfailed')
  await wait(40)

  t.true(networkIdle.quietFor(page) >= 30)
  t.is(networkIdle.inflight(page), 2)
})

test('a failed request settles the same as a finished one', t => {
  const page = createPage()
  networkIdle.track(page, { concurrency: 0 })

  page.emit('request')
  t.is(networkIdle.inflight(page), 1)
  page.emit('requestfailed')
  t.is(networkIdle.inflight(page), 0)
})

test('settling more requests than were started cannot drive inflight negative', t => {
  const page = createPage()
  networkIdle.track(page, { concurrency: 0 })

  page.emit('requestfinished')
  page.emit('requestfinished')

  t.is(networkIdle.inflight(page), 0)
})

test('tracking twice reuses the first tracker rather than double counting', t => {
  const page = createPage()
  const first = networkIdle.track(page, { concurrency: 2 })
  const second = networkIdle.track(page, { concurrency: 2 })

  t.is(first, second)
  t.is(page.listenerCount('request'), 1)
})

test('detach removes every listener and the credit with it', t => {
  const page = createPage()
  const state = networkIdle.track(page, { concurrency: 2 })

  state.detach()

  t.is(page.listenerCount('request'), 0)
  t.is(page.listenerCount('requestfinished'), 0)
  t.is(page.listenerCount('requestfailed'), 0)
  t.is(networkIdle.quietFor(page), 0)
})

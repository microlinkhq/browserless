'use strict'

const test = require('ava')
const createGoto = require('../../src')
const networkIdle = require('../../src/network-idle')

const createTrackablePage = waitForNetworkIdle => {
  const listeners = new Map()
  return {
    waitForNetworkIdle,
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
    }
  }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

test('waitUntilAuto calls page.waitForNetworkIdle with networkidle2 defaults', async t => {
  const calls = []

  const page = {
    waitForNetworkIdle: opts => {
      calls.push(opts)
      return Promise.resolve()
    }
  }

  const goto = createGoto({ timeout: 10000 })
  await goto.waitUntilAuto(page, { timeout: 5000 })

  t.is(calls.length, 1)
  t.deepEqual(calls[0], { idleTime: 500, concurrency: 2 })
})

test('waitUntilAuto credits the idle window a tracked page already served', async t => {
  const calls = []
  const page = createTrackablePage(opts => {
    calls.push(opts)
    return Promise.resolve()
  })

  networkIdle.track(page, { concurrency: 2 })
  await wait(120)

  const goto = createGoto({ timeout: 10000 })
  await goto.waitUntilAuto(page, { timeout: 5000 })

  t.is(calls.length, 1)
  t.is(calls[0].concurrency, 2)
  t.true(calls[0].idleTime < 500, `expected a credited window, got ${calls[0].idleTime}`)
  t.true(calls[0].idleTime <= 400)
})

test('waitUntilAuto waits the full window again once the page goes busy', async t => {
  const calls = []
  const page = createTrackablePage(opts => {
    calls.push(opts)
    return Promise.resolve()
  })

  networkIdle.track(page, { concurrency: 2 })
  await wait(120)
  for (let i = 0; i < 3; i++) page.emit('request')

  const goto = createGoto({ timeout: 10000 })
  await goto.waitUntilAuto(page, { timeout: 5000 })

  t.deepEqual(calls[0], { idleTime: 500, concurrency: 2 })
})

test('waitUntilAuto never asks for a negative window', async t => {
  const calls = []
  const page = createTrackablePage(opts => {
    calls.push(opts)
    return Promise.resolve()
  })

  networkIdle.track(page, { concurrency: 2 })
  await wait(600)

  const goto = createGoto({ timeout: 10000 })
  await goto.waitUntilAuto(page, { timeout: 5000 })

  t.is(calls[0].idleTime, 0)
})

test('waitUntilAuto re-asks after activity during a credited wait', async t => {
  const calls = []
  let release
  const page = createTrackablePage(opts => {
    calls.push(opts)
    if (calls.length === 1) {
      return new Promise(resolve => {
        release = resolve
      })
    }
    return Promise.resolve()
  })

  networkIdle.track(page, { concurrency: 2 })
  await wait(120)

  const goto = createGoto({ timeout: 10000 })
  const pending = goto.waitUntilAuto(page, { timeout: 5000 })

  while (calls.length === 0) await wait(5)

  t.true(calls[0].idleTime < 500, `expected a credited window, got ${calls[0].idleTime}`)

  for (let i = 0; i < 3; i++) page.emit('request')
  page.emit('requestfinished')
  release()

  await pending

  t.is(calls.length, 2)
  t.true(calls[1].idleTime > calls[0].idleTime)
  t.true(calls[1].idleTime >= 450)
})

test('waitUntilAuto respects timeout', async t => {
  const page = {
    waitForNetworkIdle: () => new Promise(resolve => setTimeout(resolve, 10000))
  }

  const goto = createGoto({ timeout: 10000 })
  const { isRejected } = await goto.waitUntilAuto(page, { timeout: 50 })

  t.true(isRejected)
})

test('waitUntilAuto resolves when network becomes idle', async t => {
  const page = {
    waitForNetworkIdle: () => Promise.resolve()
  }

  const goto = createGoto({ timeout: 10000 })
  const result = await goto.waitUntilAuto(page, { timeout: 5000 })

  t.false(result.isRejected)
})

test('waitUntilAuto is overridable via goto options', async t => {
  let customCalled = false

  const goto = createGoto({ timeout: 10000 })

  const noop = () => Promise.resolve()
  const page = {
    setViewport: noop,
    viewport: () => null,
    setExtraHTTPHeaders: noop,
    setUserAgent: noop,
    emulateMediaFeatures: noop,
    addStyleTag: noop,
    goto: () => Promise.resolve(null),
    waitForNetworkIdle: noop,
    browser: () => ({ version: () => Promise.resolve('Chrome/152.0.7977.83') }),
    _client: () => ({
      send: method =>
        Promise.resolve(
          method === 'Emulation.getScreenInfos'
            ? { screenInfos: [{ id: 'primary', width: 800, height: 600, isPrimary: true }] }
            : { screenInfo: { id: 'primary', width: 1440, height: 900, isPrimary: true } }
        )
    })
  }

  await goto(page, {
    url: 'about:blank',
    waitUntil: 'auto',
    adblock: false,
    waitUntilAuto: async () => {
      customCalled = true
    }
  })

  t.true(customCalled)
})

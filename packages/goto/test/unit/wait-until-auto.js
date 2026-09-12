'use strict'

const test = require('ava')
const createGoto = require('../../src')

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

'use strict'

const { default: test } = require('ava')

const {
  AUTOCONSENT_BINDING,
  AUTOCONSENT_WORLD,
  enableBlockingInPage,
  waitForConsent
} = require('../../../src/adblock')

const harness = () => {
  const handlers = {}
  const client = {
    on: (event, handler) => {
      handlers[event] = handler
    },
    off: () => {},
    send: async () => ({})
  }
  const page = {
    _client: () => client,
    mainFrame: () => ({ _id: 'main' }),
    on: () => {},
    off: () => {}
  }
  const run = async ({ fn }) => {
    try {
      return { value: await fn }
    } catch (error) {
      return { reason: error }
    }
  }
  enableBlockingInPage(page, run, 5000)
  handlers['Runtime.executionContextCreated']({
    context: { id: 1, name: AUTOCONSENT_WORLD, auxData: { frameId: 'main' } }
  })
  const send = message => {
    handlers['Runtime.bindingCalled']({
      name: AUTOCONSENT_BINDING,
      executionContextId: 1,
      payload: JSON.stringify(message)
    })
  }
  return { page, send }
}

const settled = () => new Promise(resolve => setImmediate(resolve))

test('a settled consent wait starts again for a later popup', async t => {
  const debug = require('debug')
  debug.enable('browserless:goto:adblock')
  const lines = []
  const write = process.stderr.write
  process.stderr.write = (chunk, ...args) => {
    lines.push(String(chunk))
    return write.call(process.stderr, chunk, ...args)
  }
  t.teardown(() => {
    process.stderr.write = write
    debug.disable()
  })

  const { page, send } = harness()

  send({ type: 'cmpDetected', cmp: 'early' })
  send({ type: 'popupFound', cmp: 'early' })
  await settled()
  t.is(page._autoconsentConsent, undefined)
  t.false(lines.some(line => line.includes('autoconsent:error')))

  send({ type: 'init' })
  t.is(page._autoconsentConsent.detecting, undefined)

  send({ type: 'cmpDetected', cmp: 'load' })
  const firstDetecting = page._autoconsentConsent.detecting
  t.false(firstDetecting.settled)

  send({ type: 'cmpDetected', cmp: 'load-again' })
  t.is(page._autoconsentConsent.detecting, firstDetecting)

  firstDetecting.resolve()
  await waitForConsent(page)

  send({ type: 'popupFound', cmp: 'load' })
  const firstPopup = page._autoconsentConsent.popup
  t.false(firstPopup.settled)
  t.true(firstDetecting.settled)

  send({ type: 'popupFound', cmp: 'load-again' })
  t.is(page._autoconsentConsent.popup, firstPopup)

  firstPopup.resolve()
  await waitForConsent(page)

  send({ type: 'cmpDetected', cmp: 'late' })
  const lateDetecting = page._autoconsentConsent.detecting
  t.not(lateDetecting, firstDetecting)
  t.false(lateDetecting.settled)

  let done = false
  const waiting = waitForConsent(page).then(() => {
    done = true
  })
  await settled()
  t.false(done)
  t.is(page._autoconsentConsent.detecting, lateDetecting)

  send({ type: 'popupFound', cmp: 'late' })
  const latePopup = page._autoconsentConsent.popup
  t.not(latePopup, firstPopup)
  t.false(latePopup.settled)
  await settled()
  t.false(done)

  latePopup.resolve()
  await waiting
  t.true(done)
})

test('waitForConsent resolves a page that has not started consent', async t => {
  const goto = require('../../../src')({ timeout: 30000 })
  const result = await goto.waitForConsent({})
  t.false(result.isRejected)
})

test('waitForConsent stops at the timeout it was given', async t => {
  const goto = require('../../../src')({ timeout: 30000 })
  const page = {
    _autoconsentConsent: {
      detecting: { promise: new Promise(() => {}) }
    }
  }
  const result = await goto.waitForConsent(page, { timeout: 50 })
  t.true(result.isRejected)
})

test('a detection with no popup settles on its own', async t => {
  const { page, send } = harness()
  send({ type: 'init' })
  send({ type: 'cmpDetected', cmp: 'load' })
  const detecting = page._autoconsentConsent.detecting
  t.false(detecting.settled)
  t.true(detecting.until - Date.now() >= 200)
  await new Promise(resolve => setTimeout(resolve, 400))
  t.true(detecting.settled)
  t.is(page._autoconsentConsent.popup, undefined)
  await waitForConsent(page)
})

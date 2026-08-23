'use strict'

const { setTimeout: sleep } = require('node:timers/promises')
const test = require('ava')

const { captureWithNavigationRetry } = require('../src/index.js')

const sessionClosedError = () =>
  new Error(
    'Protocol error (Page.captureScreenshot): Session closed. Most likely the page has been closed.'
  )

const createPage = ({ isClosed = false } = {}) => ({ isClosed: () => isClosed })

test('a closed page is terminal: it does not retry', async t => {
  let attempts = 0
  let waits = 0

  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw sessionClosedError()
      },
      {
        page: createPage({ isClosed: true }),
        goto: {
          waitUntilAuto: async () => {
            waits++
          }
        },
        timeout: 5000
      }
    )
  )

  t.true(error.message.includes('Session closed'))
  t.is(attempts, 1)
  t.is(waits, 0)
})

test('an immediate waitUntilAuto does not spin the retry loop', async t => {
  let attempts = 0

  const start = Date.now()
  await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw sessionClosedError()
      },
      {
        page: createPage(),
        goto: { waitUntilAuto: async () => {} },
        timeout: 750
      }
    )
  )

  const elapsed = Date.now() - start
  t.true(elapsed >= 700, `expected the full budget to be spent, got ${elapsed}ms`)
  t.true(attempts <= 8, `expected a paced retry, got ${attempts} attempts`)
})

test('a wait that spends the budget does not capture again', async t => {
  let attempts = 0

  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw sessionClosedError()
      },
      {
        page: createPage(),
        goto: { waitUntilAuto: (page, { timeout }) => sleep(timeout) },
        timeout: 300
      }
    )
  )

  t.true(error.message.includes('Session closed'))
  t.is(attempts, 1)
})

test('a live page still retries after the context is destroyed', async t => {
  let attempts = 0

  const screenshot = await captureWithNavigationRetry(
    () => {
      if (++attempts === 1) throw sessionClosedError()
      return 'screenshot'
    },
    {
      page: createPage(),
      goto: { waitUntilAuto: async () => {} },
      timeout: 5000
    }
  )

  t.is(screenshot, 'screenshot')
  t.is(attempts, 2)
})

test('a non-transient error is rethrown as-is', async t => {
  let attempts = 0

  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw new Error('Evaluation failed: boom')
      },
      {
        page: createPage(),
        goto: { waitUntilAuto: async () => {} },
        timeout: 5000
      }
    )
  )

  t.is(error.message, 'Evaluation failed: boom')
  t.is(attempts, 1)
})

'use strict'

const { setTimeout: sleep } = require('node:timers/promises')
const test = require('ava')

const { captureWithNavigationRetry } = require('../src/index.js')

// Puppeteer raises `TargetCloseError` (a `ProtocolError`) from `CdpSession.send`
// once the session is detached. Reproduce the name, not just the message.
const sessionClosedError = () => {
  const error = new Error(
    'Protocol error (Page.captureScreenshot): Session closed. Most likely the page has been closed.'
  )
  error.name = 'TargetCloseError'
  return error
}

const navigationError = () =>
  new Error('Execution context was destroyed, most likely because of a navigation.')

const createPage = ({ isClosed = false } = {}) => ({ isClosed: () => isClosed })

test('a closed page is terminal even for an otherwise transient error', async t => {
  let attempts = 0
  let waits = 0

  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw navigationError()
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

  t.true(error.message.includes('Execution context was destroyed'))
  t.is(attempts, 1)
  t.is(waits, 0)
})

test('a protocol Target closed is terminal even without TargetCloseError', async t => {
  let attempts = 0
  let waits = 0

  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw new Error(
          'Protocol error (Runtime.evaluate): Protocol error (Runtime.evaluate): Target closed'
        )
      },
      {
        page: createPage({ isClosed: false }),
        goto: {
          waitUntilAuto: async () => {
            waits++
          }
        },
        timeout: 5000
      }
    )
  )

  t.true(error.message.includes('Target closed'))
  t.is(attempts, 1, 'a gone target is never retried in place')
  t.is(waits, 0)
})

test('a detached session is terminal even while the page still reports open', async t => {
  let attempts = 0
  let waits = 0

  // The CDP session flips `detached` before the page's close event lands, so
  // there is a window where every call throws yet `isClosed()` answers false.
  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw sessionClosedError()
      },
      {
        page: createPage({ isClosed: false }),
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
  t.is(attempts, 1, 'a detached session is never retried')
  t.is(waits, 0)
})

test('a wait that spends the budget does not capture again', async t => {
  let attempts = 0
  const timeout = 300

  const error = await t.throwsAsync(
    captureWithNavigationRetry(
      () => {
        attempts++
        throw navigationError()
      },
      {
        page: createPage(),
        // Overshoot the budget rather than land exactly on it: a timer may
        // settle a fraction before the elapsed clock reads its own deadline,
        // and the assertion is about spending the budget, not about the tie.
        goto: { waitUntilAuto: () => sleep(timeout * 2) },
        timeout
      }
    )
  )

  t.true(error.message.includes('Execution context was destroyed'))
  t.is(attempts, 1)
})

test('a live page still retries after the context is destroyed', async t => {
  let attempts = 0

  const screenshot = await captureWithNavigationRetry(
    () => {
      if (++attempts === 1) throw navigationError()
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

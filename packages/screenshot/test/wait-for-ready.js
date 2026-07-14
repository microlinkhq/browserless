'use strict'

const test = require('ava')

const { waitForReady } = require('..')

// A fake page whose `evaluate` yields scripted snapshots (or throws to simulate
// a client-side navigation destroying the execution context). No browser: this
// exercises the gate's decision logic deterministically and fast.
const scriptedPage = frames => {
  let i = 0
  return {
    evaluate: async () => {
      const frame = frames[Math.min(i, frames.length - 1)]
      i++
      if (frame instanceof Error) throw frame
      return frame
    }
  }
}

const READY = { height: 1000, images: 3, decoded: 3, complete: true }

test('resolves once the page is quiet: height stable, images decoded, load complete', async t => {
  const page = scriptedPage([
    { height: 500, images: 3, decoded: 1, complete: false }, // still loading
    { height: 900, images: 3, decoded: 2, complete: true }, // images not all decoded
    READY,
    READY,
    READY,
    READY,
    READY // stable
  ])
  const r = await waitForReady(page, { timeout: 2000, quietMs: 40, poll: 10 })
  t.false(r.timedOut)
  t.is(r.height, 1000)
  t.is(r.resets, 0)
})

test('navigation-tolerant: a destroyed context resets the quiet window, then resolves', async t => {
  const boom = new Error('Execution context was destroyed, most likely because of a navigation.')
  const page = scriptedPage([READY, READY, boom, boom, READY, READY, READY, READY])
  const r = await waitForReady(page, { timeout: 2000, quietMs: 40, poll: 10 })
  t.false(r.timedOut)
  t.true(r.resets >= 1, 'counted the navigation resets')
  t.is(r.height, 1000)
})

test('a non-navigation evaluate error surfaces instead of spinning to a timeout', async t => {
  const boom = new Error('Evaluation failed: ReferenceError: snapshot is not defined')
  const page = scriptedPage([READY, boom])
  await t.throwsAsync(() => waitForReady(page, { timeout: 2000, quietMs: 40, poll: 10 }), {
    message: /Evaluation failed/
  })
})

test('times out when the page never settles (height keeps growing)', async t => {
  let h = 0
  const page = {
    evaluate: async () => ({ height: (h += 100), images: 2, decoded: 2, complete: true })
  }
  const r = await waitForReady(page, { timeout: 200, quietMs: 60, poll: 10 })
  t.true(r.timedOut)
})

test('fails fast when `timeout` is missing instead of returning a NaN deadline', async t => {
  const page = scriptedPage([READY])
  await t.throwsAsync(() => waitForReady(page, { quietMs: 40, poll: 10 }), {
    instanceOf: TypeError
  })
})

test('an imageless page is ready on height/readyState quiet alone', async t => {
  const s = { height: 800, images: 0, decoded: 0, complete: true }
  const page = scriptedPage([s, s, s, s, s])
  const r = await waitForReady(page, { timeout: 1000, quietMs: 40, poll: 10 })
  t.false(r.timedOut)
  t.is(r.images, 0)
})

'use strict'

const { getBrowserContext } = require('@browserless/test')
const { EventEmitter } = require('events')
const test = require('ava')

const createScreencast = require('..')

const settle = () => new Promise(resolve => setImmediate(resolve))

const createFakeCdp = () => {
  const cdp = new EventEmitter()
  const calls = []

  cdp.send = async (method, params) => {
    calls.push({ method, params })
  }

  return { cdp, calls }
}

test('starts screencast with jpeg defaults', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const screencast = createScreencast(page)

  screencast.onFrame(() => {})
  await screencast.start()

  t.deepEqual(calls, [
    {
      method: 'Page.startScreencast',
      params: {
        format: 'jpeg',
        quality: 80
      }
    }
  ])
})

test('lets screencast options override defaults', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const screencast = createScreencast(page, {
    format: 'png',
    quality: 100,
    everyNthFrame: 2
  })

  screencast.onFrame(() => {})
  await screencast.start()

  t.deepEqual(calls, [
    {
      method: 'Page.startScreencast',
      params: {
        format: 'png',
        quality: 100,
        everyNthFrame: 2
      }
    }
  ])
})

test('capture frames', async t => {
  const frames = []

  const browserless = await getBrowserContext(t)
  const page = await browserless.page()

  const screencast = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  screencast.onFrame((data, metadata) => {
    frames.push({ data, metadata })
  })

  await screencast.start()
  await page.goto('https://example.com', { waitUntil: 'load' })

  // Page.startScreencast emits a frame per compositor commit. Under the GL
  // backend a fully static page may not commit again after the initial paint,
  // so drive a visual change each tick to force commits and poll until the
  // screencast captures at least one frame.
  const deadline = Date.now() + 5000
  while (frames.length === 0 && Date.now() < deadline) {
    await page.evaluate(() => {
      document.body.style.background = `hsl(${Date.now() % 360}, 50%, 50%)`
    })
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  await screencast.stop()

  t.true(frames.length > 0)
  frames.forEach(({ data, metadata }) => {
    t.truthy(data)
    t.is(typeof metadata, 'object')
    t.truthy(metadata.timestamp)
  })
})

test('clean up cdp frame listeners across screencast sessions', async t => {
  const browserless = await getBrowserContext(t)
  const page = await browserless.page()
  const cdp = page._client()

  const countListeners = () => cdp.listenerCount('Page.screencastFrame')

  const screencastA = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  t.is(countListeners(), 0)

  screencastA.onFrame(() => {})
  await screencastA.start()
  t.is(countListeners(), 1)
  await screencastA.stop()
  t.is(countListeners(), 0)

  const screencastB = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  screencastB.onFrame(() => {})
  await screencastB.start()
  t.is(countListeners(), 1)
  await screencastB.stop()
  t.is(countListeners(), 0)
})

test('acks screencast frames after async onFrame resolves', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const frame = Promise.withResolvers()
  let received

  const screencast = createScreencast(page, {})
  screencast.onFrame((data, metadata) => {
    received = { data, metadata }
    return frame.promise
  })

  await screencast.start()
  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { timestamp: 1 },
    sessionId: 42
  })

  t.deepEqual(received, { data: 'frame', metadata: { timestamp: 1 } })
  t.false(calls.some(({ method }) => method === 'Page.screencastFrameAck'))

  frame.resolve()
  await settle()

  t.deepEqual(calls, [
    { method: 'Page.startScreencast', params: { format: 'jpeg', quality: 80 } },
    { method: 'Page.screencastFrameAck', params: { sessionId: 42 } }
  ])
})

test('acks screencast frames after async onFrame rejects', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }

  const screencast = createScreencast(page, {})
  screencast.onFrame(() => Promise.reject(new Error('frame failed')))

  await screencast.start()
  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { timestamp: 1 },
    sessionId: 43
  })
  await settle()

  t.deepEqual(calls, [
    { method: 'Page.startScreencast', params: { format: 'jpeg', quality: 80 } },
    { method: 'Page.screencastFrameAck', params: { sessionId: 43 } }
  ])
})

test('acks and does not rethrow when a synchronous onFrame throws', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }

  const screencast = createScreencast(page, {})
  screencast.onFrame(() => {
    throw new Error('frame failed')
  })

  await screencast.start()

  // A sync throw must be swallowed, not propagated into the CDP dispatch loop.
  t.notThrows(() =>
    cdp.emit('Page.screencastFrame', {
      data: 'frame',
      metadata: { timestamp: 1 },
      sessionId: 44
    })
  )
  await settle()

  t.deepEqual(calls, [
    { method: 'Page.startScreencast', params: { format: 'jpeg', quality: 80 } },
    { method: 'Page.screencastFrameAck', params: { sessionId: 44 } }
  ])
})

test('does not ack a frame whose async onFrame settles after stop()', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const frame = Promise.withResolvers()

  const screencast = createScreencast(page, {})
  screencast.onFrame(() => frame.promise)

  await screencast.start()
  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { timestamp: 1 },
    sessionId: 45
  })

  await screencast.stop()
  frame.resolve()
  await settle()

  // No ack for the in-flight frame: its session was torn down by stop().
  t.false(
    calls.some(
      ({ method, params }) => method === 'Page.screencastFrameAck' && params.sessionId === 45
    )
  )
})

test('does not ack a frame whose synchronous onFrame stops mid-frame', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }

  const screencast = createScreencast(page, {})
  // "capture then stop" pattern: a synchronous onFrame that tears down the
  // session and returns undefined — the sync ack path must honor stopped too.
  screencast.onFrame(() => screencast.stop())

  await screencast.start()
  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { timestamp: 1 },
    sessionId: 47
  })
  await settle()

  t.false(
    calls.some(
      ({ method, params }) => method === 'Page.screencastFrameAck' && params.sessionId === 47
    )
  )
})

test('re-acks async frames after stop() then start() on the same instance', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }

  const screencast = createScreencast(page, {})
  screencast.onFrame(() => Promise.resolve())

  await screencast.start()
  await screencast.stop()
  await screencast.start()

  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { timestamp: 1 },
    sessionId: 46
  })
  await settle()

  // start() must clear the stopped flag so the restarted session acks again.
  t.true(
    calls.some(
      ({ method, params }) => method === 'Page.screencastFrameAck' && params.sessionId === 46
    )
  )
})

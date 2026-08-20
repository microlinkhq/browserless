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

  // Local page: no network. setContent navigates (session restarts). Mutate a
  // style each tick so the new Page.startScreencast emits a frame under GL/xvfb.
  await page.setContent('<!doctype html><body></body>', { waitUntil: 'load' })

  const deadline = Date.now() + 10000
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

  const countFrames = () => cdp.listenerCount('Page.screencastFrame')
  const navBaseline = cdp.listenerCount('Page.frameNavigated')

  const screencastA = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  t.is(countFrames(), 0)

  screencastA.onFrame(() => {})
  await screencastA.start()
  t.is(countFrames(), 1)
  t.is(cdp.listenerCount('Page.frameNavigated'), navBaseline + 1)
  await screencastA.stop()
  t.is(countFrames(), 0)
  t.is(cdp.listenerCount('Page.frameNavigated'), navBaseline)

  const screencastB = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  screencastB.onFrame(() => {})
  await screencastB.start()
  t.is(countFrames(), 1)
  await screencastB.stop()
  t.is(countFrames(), 0)
})

test('restarts screencast after main-frame navigation', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const screencast = createScreencast(page)

  screencast.onFrame(() => {})
  await screencast.start()
  calls.length = 0

  cdp.emit('Page.frameNavigated', { frame: { id: 'main' } })
  await settle()

  t.deepEqual(calls, [{ method: 'Page.startScreencast', params: { format: 'jpeg', quality: 80 } }])
})

test('does not restart screencast after iframe navigation', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const screencast = createScreencast(page)

  screencast.onFrame(() => {})
  await screencast.start()
  calls.length = 0

  cdp.emit('Page.frameNavigated', { frame: { id: 'iframe', parentId: 'main' } })
  await settle()

  t.deepEqual(calls, [])
})

test('does not restart screencast after stop()', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  const screencast = createScreencast(page)

  screencast.onFrame(() => {})
  await screencast.start()
  await screencast.stop()
  calls.length = 0

  cdp.emit('Page.frameNavigated', { frame: { id: 'main' } })
  await settle()

  t.false(calls.some(({ method }) => method === 'Page.startScreencast'))
})

test('delivers frames when CDP omits metadata.timestamp', async t => {
  const { cdp, calls } = createFakeCdp()
  const page = { _client: () => cdp }
  let received

  const screencast = createScreencast(page, {})
  screencast.onFrame((data, metadata) => {
    received = { data, metadata }
  })

  await screencast.start()
  const before = Date.now() / 1000
  cdp.emit('Page.screencastFrame', {
    data: 'frame',
    metadata: { deviceWidth: 800 },
    sessionId: 41
  })
  const after = Date.now() / 1000

  t.is(received.data, 'frame')
  t.is(received.metadata.deviceWidth, 800)
  t.true(received.metadata.timestamp >= before)
  t.true(received.metadata.timestamp <= after)
  t.true(calls.some(({ method }) => method === 'Page.screencastFrameAck'))
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

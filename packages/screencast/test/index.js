'use strict'

const { getBrowserContext } = require('@browserless/test')
const { EventEmitter } = require('events')
const test = require('ava')

const createScreencast = require('..')

const createDeferred = () => {
  let resolve
  let reject
  const promise = new Promise((_resolve, _reject) => {
    resolve = _resolve
    reject = _reject
  })
  return { promise, resolve, reject }
}

const settle = () => new Promise(resolve => setImmediate(resolve))

const createFakeCdp = () => {
  const cdp = new EventEmitter()
  const calls = []

  cdp.send = async (method, params) => {
    calls.push({ method, params })
  }

  return { cdp, calls }
}

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
  const frame = createDeferred()
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
    { method: 'Page.startScreencast', params: {} },
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
    { method: 'Page.startScreencast', params: {} },
    { method: 'Page.screencastFrameAck', params: { sessionId: 43 } }
  ])
})

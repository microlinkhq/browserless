'use strict'

const { EventEmitter } = require('events')
const fs = require('fs/promises')
const path = require('path')
const test = require('ava')
const os = require('os')

const { EXTENSION_ID, MAX_FRAME_RATE } = require('../src/constants')

const DEFAULT_DEVICE = Object.freeze({
  userAgent:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.89 Safari/537.36',
  viewport: {
    width: 1280,
    height: 800,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    isLandscape: false
  }
})

const createGoto = onCall => {
  const goto = async (page, opts) => {
    const result = typeof onCall === 'function' ? await onCall(page, opts) : null
    if (result && result.device) return result
    return { device: DEFAULT_DEVICE }
  }

  return goto
}

let nextPort = 55000

class FakeWebSocketServer extends EventEmitter {
  constructor () {
    super()
    this.port = nextPort++
    FakeWebSocketServer.latest = this
    FakeWebSocketServer.byPort.set(this.port, this)
    setImmediate(() => this.emit('listening'))
  }

  address () {
    return { port: this.port }
  }

  connect ({ index, chunks = [] }) {
    const socket = new EventEmitter()
    socket.close = () => setImmediate(() => socket.emit('close'))

    this.emit('connection', socket, { url: `/?index=${index}` })

    for (const chunk of chunks) socket.emit('message', chunk)

    return socket
  }

  close (callback) {
    FakeWebSocketServer.byPort.delete(this.port)
    setImmediate(() => callback && callback())
  }
}

FakeWebSocketServer.byPort = new Map()

const loadCapture = () => {
  const ws = require('ws')
  const previous = ws.WebSocketServer
  const capturePath = require.resolve('..')

  ws.WebSocketServer = FakeWebSocketServer
  delete require.cache[capturePath]

  const capture = require('..')

  ws.WebSocketServer = previous

  return capture
}

const createWorkerBrowser = ({
  extensionId = EXTENSION_ID,
  chunks = [Buffer.from('a'), Buffer.from('b')],
  hasTab = true
} = {}) => {
  let stopCalls = 0
  let workerReady = true
  let onStartRecording
  const socketsByIndex = new Map()

  const worker = {
    async evaluate (fn, arg) {
      const source = fn.toString()

      if (
        source.includes('typeof globalThis.START_RECORDING') &&
        source.includes('typeof globalThis.STOP_RECORDING')
      ) {
        return workerReady
      }

      if (source.includes('globalThis.chrome.debugger.getTargets')) {
        if (!hasTab) return null
        if (arg === 'target-2') return 2
        return 1
      }

      if (source.includes('globalThis.START_RECORDING(settings)')) {
        if (typeof onStartRecording === 'function') await onStartRecording(arg)
        const server = FakeWebSocketServer.byPort.get(arg.port) || FakeWebSocketServer.latest
        const socket = server.connect({ index: arg.index, chunks })
        socketsByIndex.set(arg.index, socket)
        if (arg.duration > 0) {
          setTimeout(() => socket.close(), arg.duration)
        }
        return
      }

      if (source.includes('globalThis.STOP_RECORDING(index)')) {
        stopCalls++
        const socket = socketsByIndex.get(arg)
        if (socket) socket.close()
      }
    }
  }

  const target = {
    type: () => 'service_worker',
    url: () => `chrome-extension://${extensionId}/background.js`,
    worker: async () => worker
  }

  return {
    __worker: worker,
    __target: target,
    __stopCalls: () => stopCalls,
    __setWorkerReady: value => {
      workerReady = value
    },
    __setOnStartRecording: fn => {
      onStartRecording = fn
    },
    __newPageCalls: 0,
    targets () {
      return [target]
    },
    async newPage () {
      this.__newPageCalls++
      return {}
    }
  }
}

const createFixture = ({
  chunks = [Buffer.from('a'), Buffer.from('b')],
  hasTab = true,
  browser = createWorkerBrowser({ chunks, hasTab }),
  targetId = 'target-1'
} = {}) => {
  const page = {
    _viewport: {
      width: 1280,
      height: 800,
      deviceScaleFactor: 2,
      isMobile: false,
      hasTouch: false,
      isLandscape: false
    },
    _targetId: targetId,
    browser () {
      return browser
    },
    viewport () {
      return this._viewport
    },
    async setViewport (nextViewport) {
      this._viewport = nextViewport
    },
    async evaluate () {
      return { width: 800, height: 600, deviceScaleFactor: 2 }
    },
    url () {
      return 'https://example.com/'
    },
    target () {
      return {
        createCDPSession: async () => ({
          send: async method =>
            method === 'Target.getTargetInfo'
              ? {
                  targetInfo: {
                    targetId: page._targetId
                  }
                }
              : null,
          detach: async () => {}
        })
      }
    }
  }

  return { page }
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

const createDeferred = () => {
  let resolve
  const promise = new Promise(_resolve => {
    resolve = _resolve
  })
  return { promise, resolve }
}

const waitUntil = async (predicate, { timeout = 500, interval = 10 } = {}) => {
  const startedAt = Date.now()

  while (!predicate()) {
    if (Date.now() - startedAt >= timeout) return false
    await wait(interval)
  }

  return true
}

test('capture returns a video buffer', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const gotoCalls = []
  const capture = createCapture({
    goto: createGoto((page, opts) => gotoCalls.push({ page, opts }))
  })

  const result = await capture(page)('https://example.com', {
    duration: 20,
    audio: false,
    video: true
  })

  t.true(Buffer.isBuffer(result))
  t.deepEqual(result, Buffer.from('ab'))
  t.is(gotoCalls.length, 1)
  t.is(gotoCalls[0].opts.url, 'https://example.com')
  t.deepEqual(page.viewport(), {
    width: 1280,
    height: 800,
    deviceScaleFactor: 2,
    isMobile: false,
    hasTouch: false,
    isLandscape: false
  })
})

test('exports capture format and quality defaults', t => {
  const createCapture = loadCapture()

  t.deepEqual(createCapture.TYPES, ['webm', 'mp4'])
  t.deepEqual(createCapture.QUALITIES, ['extra-high', 'high', 'medium', 'low', 'extra-low'])
  t.is(createCapture.DEFAULT.type, 'mp4')
  t.is(createCapture.DEFAULT.quality, 'high')
})

test('uses effective page viewport after goto', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({
    goto: createGoto(async () => {
      return {
        device: {
          ...DEFAULT_DEVICE,
          viewport: {
            width: 390,
            height: 844,
            deviceScaleFactor: 3,
            isMobile: true,
            hasTouch: true,
            isLandscape: false
          }
        }
      }
    })
  })

  await capture(page)('https://example.com', {
    duration: 20,
    audio: false,
    video: true
  })

  t.deepEqual(startRecordingPayload.videoConstraints, {
    mandatory: {
      minWidth: 1170,
      minHeight: 2532,
      maxWidth: 1170,
      maxHeight: 2532,
      maxFrameRate: MAX_FRAME_RATE
    }
  })
})

test('injects viewport-based constraints by default', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, audio: false, video: true })

  t.deepEqual(startRecordingPayload.videoConstraints, {
    mandatory: {
      minWidth: 2560,
      minHeight: 1600,
      maxWidth: 2560,
      maxHeight: 1600,
      maxFrameRate: MAX_FRAME_RATE
    }
  })
})

test('supports `type: webm`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, type: 'webm' })

  t.is(startRecordingPayload.mimeType, 'video/webm;codecs=vp9')
  t.is(startRecordingPayload.tabId, 1)
})

test('supports `type: mp4`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, type: 'mp4' })

  t.is(startRecordingPayload.mimeType, 'video/mp4;codecs=avc1.4D401F')
})

test('ignores `mimeType` option and uses mp4 defaults', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 20,
    mimeType: 'video/mp4;codecs=avc1'
  })

  t.is(startRecordingPayload.mimeType, 'video/mp4;codecs=avc1.4D401F')
})

test('supports custom `codec` for webm', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 20,
    type: 'webm',
    codec: 'vp8'
  })

  t.is(startRecordingPayload.mimeType, 'video/webm;codecs=vp8')
})

test('supports custom `codec` for mp4', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 20,
    type: 'mp4',
    codec: 'avc1.640033'
  })

  t.is(startRecordingPayload.mimeType, 'video/mp4;codecs=avc1.640033')
})

test('supports `quality: extra-high`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, quality: 'extra-high' })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 20000000
  })
})

test('supports `quality: high`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, quality: 'high' })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 8000000
  })
})

test('supports `quality: medium`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, quality: 'medium' })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 5000000
  })
})

test('supports `quality: low`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, quality: 'low' })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 2500000
  })
})

test('supports `quality: extra-low`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, quality: 'extra-low' })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 1000000
  })
})

test('uses default `quality: high`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20 })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 8000000
  })
})

test('normalizes spaced quality values', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, quality: 'extra high' })

  t.deepEqual(startRecordingPayload.recorderOptions, {
    videoBitsPerSecond: 20000000
  })
})

test('maps audio/video object values to track constraints', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 20,
    audio: { echoCancellation: false, autoGainControl: false },
    video: {
      mandatory: {
        minWidth: 1024,
        minHeight: 576,
        maxWidth: 1024,
        maxHeight: 576
      }
    }
  })

  t.true(startRecordingPayload.audio)
  t.true(startRecordingPayload.video)
  t.deepEqual(startRecordingPayload.audioConstraints, {
    echoCancellation: false,
    autoGainControl: false
  })
  t.deepEqual(startRecordingPayload.videoConstraints, {
    mandatory: {
      minWidth: 1024,
      minHeight: 576,
      maxWidth: 1024,
      maxHeight: 576,
      maxFrameRate: MAX_FRAME_RATE
    }
  })
})

test('forces `maxFrameRate: 60` for custom video constraints', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', {
    duration: 20,
    audio: false,
    video: {
      mandatory: {
        maxFrameRate: 30,
        maxWidth: 800,
        maxHeight: 600
      }
    }
  })

  t.is(startRecordingPayload.videoConstraints.mandatory.maxFrameRate, MAX_FRAME_RATE)
})

test('capture writes path and returns the same buffer', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture({ chunks: [Buffer.from('chunk-1')] })
  const capture = createCapture({ goto: createGoto() })

  const outputPath = path.join(os.tmpdir(), `browserless-capture-${Date.now()}.webm`)
  t.teardown(async () => fs.unlink(outputPath).catch(() => {}))

  const result = await capture(page)('https://example.com', {
    path: outputPath,
    duration: 20,
    audio: false,
    video: true
  })

  const file = await fs.readFile(outputPath)

  t.deepEqual(result, Buffer.from('chunk-1'))
  t.deepEqual(file, result)
})

test('rejects when both audio and video are false', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { audio: false, video: false }), {
    instanceOf: TypeError,
    message: /At least one of `audio` or `video` must be true/
  })
})

test('rejects invalid `audio` option shape', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { audio: 1 }), {
    instanceOf: TypeError,
    message: /Expected `audio` to be a boolean or an object/
  })
})

test('rejects unsupported type', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { type: 'avi' }), {
    instanceOf: TypeError,
    message: /Supported types: webm, mp4/
  })
})

test('rejects unsupported quality', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { quality: 'ultra' }), {
    instanceOf: TypeError,
    message: /Supported qualities: extra-high, high, medium, low, extra-low/
  })
})

test('rejects empty `codec`', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { codec: '   ' }), {
    instanceOf: TypeError,
    message: /non-empty string/
  })
})

test('rejects when extension service worker is unavailable', async t => {
  const createCapture = loadCapture()
  const browser = createWorkerBrowser()
  browser.__setWorkerReady(false)
  const { page } = createFixture({ browser })
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { duration: 20 }), {
    message: /Unable to connect to capture extension service worker/
  })
})

test('uses service worker runtime without opening extension tab', async t => {
  const createCapture = loadCapture()
  const browser = createWorkerBrowser({
    extensionId: createCapture.extensionId,
    chunks: [Buffer.from('worker')]
  })
  const { page } = createFixture({ browser })
  const capture = createCapture({ goto: createGoto() })

  const result = await capture(page)('https://example.com', {
    duration: 20,
    audio: false,
    video: true
  })

  t.deepEqual(result, Buffer.from('worker'))
  t.is(browser.__newPageCalls, 0)
  t.true(browser.__stopCalls() > 0)
})

test('allows setup in parallel when captures share the same browser', async t => {
  const createCapture = loadCapture()
  const browser = createWorkerBrowser({ chunks: [Buffer.from('shared')] })
  const enteredFirst = createDeferred()
  const releaseFirst = createDeferred()
  let startRecordingCalls = 0
  let secondStartRecordingCalls = 0

  browser.__setOnStartRecording(async () => {
    startRecordingCalls++
    if (startRecordingCalls === 1) {
      enteredFirst.resolve()
      await releaseFirst.promise
      return
    }
    secondStartRecordingCalls++
  })

  const { page: firstPage } = createFixture({ browser, targetId: 'target-1' })

  const { page: secondPage } = createFixture({ browser, targetId: 'target-2' })

  const capture = createCapture({ goto: createGoto() })

  const firstTask = capture(firstPage)('https://example.com/first', {
    duration: 20,
    audio: false,
    video: true
  })

  await enteredFirst.promise

  const secondTask = capture(secondPage)('https://example.com/second', {
    duration: 20,
    audio: false,
    video: true
  })

  const secondEnteredBeforeRelease = await waitUntil(() => secondStartRecordingCalls > 0)
  t.true(secondEnteredBeforeRelease)

  releaseFirst.resolve()

  const [firstBuffer, secondBuffer] = await Promise.all([firstTask, secondTask])
  t.true(Buffer.isBuffer(firstBuffer))
  t.true(Buffer.isBuffer(secondBuffer))
  t.is(secondStartRecordingCalls, 1)
})

test('allows setup in parallel when captures use different browsers', async t => {
  const createCapture = loadCapture()
  const enteredFirst = createDeferred()
  const releaseFirst = createDeferred()
  let secondStartRecordingCalls = 0

  const firstBrowser = createWorkerBrowser({ chunks: [Buffer.from('first')] })
  firstBrowser.__setOnStartRecording(async () => {
    enteredFirst.resolve()
    await releaseFirst.promise
  })

  const secondBrowser = createWorkerBrowser({ chunks: [Buffer.from('second')] })
  secondBrowser.__setOnStartRecording(async () => {
    secondStartRecordingCalls++
  })

  const { page: firstPage } = createFixture({
    browser: firstBrowser
  })

  const { page: secondPage } = createFixture({
    browser: secondBrowser
  })

  const capture = createCapture({ goto: createGoto() })

  const firstTask = capture(firstPage)('https://example.com/first-browser', {
    duration: 20,
    audio: false,
    video: true
  })

  await enteredFirst.promise

  const secondTask = capture(secondPage)('https://example.com/second-browser', {
    duration: 20,
    audio: false,
    video: true
  })

  const secondEnteredBeforeRelease = await waitUntil(() => secondStartRecordingCalls > 0)
  t.true(secondEnteredBeforeRelease)

  releaseFirst.resolve()

  const [firstBuffer, secondBuffer] = await Promise.all([firstTask, secondTask])
  t.true(Buffer.isBuffer(firstBuffer))
  t.true(Buffer.isBuffer(secondBuffer))
})

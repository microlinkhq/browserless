'use strict'

const { EventEmitter } = require('events')
const fs = require('fs').promises
const path = require('path')
const test = require('ava')
const os = require('os')
const EXTENSION_ID = 'jjndjgheafjngoipoacpjgeicjeomjli'
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

const createGoto = onCall => async (page, opts) => {
  if (typeof onCall === 'function') onCall(page, opts)
  return { device: DEFAULT_DEVICE }
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

      if (source.includes('globalThis.chrome.tabs.query')) return hasTab ? [{ id: 1 }] : []
      if (source.includes('globalThis.chrome.tabs.update')) return
      if (source.includes('globalThis.chrome.tabs.get')) return { id: arg, width: 800, height: 600 }

      if (source.includes('globalThis.START_RECORDING(settings)')) {
        if (typeof onStartRecording === 'function') onStartRecording(arg)
        const server = FakeWebSocketServer.byPort.get(arg.port) || FakeWebSocketServer.latest
        const socket = server.connect({ index: arg.index, chunks })
        socketsByIndex.set(arg.index, socket)
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
  bringToFront = async () => {}
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
    bringToFront,
    keyboard: {
      async down () {},
      async up () {},
      async press () {}
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
    frameSize: 10,
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
      maxHeight: 1600
    }
  })
})

test('maps `type` to MediaRecorder mimeType', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const browser = page.browser()
  browser.__setOnStartRecording(payload => {
    startRecordingPayload = payload
  })

  const capture = createCapture({ goto: createGoto() })
  await capture(page)('https://example.com', { duration: 20, type: 'mp4' })

  t.is(startRecordingPayload.mimeType, 'video/mp4')
})

test('mimeType takes precedence over `type`', async t => {
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
    mimeType: 'video/mp4;codecs=avc1'
  })

  t.is(startRecordingPayload.mimeType, 'video/mp4;codecs=avc1')
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
    frameSize: 10,
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

test('rejects unsupported type', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: createGoto() })

  await t.throwsAsync(() => capture(page)('https://example.com', { type: 'avi' }), {
    instanceOf: TypeError,
    message: /Unsupported `type` "avi"/
  })
})

test('requires viewport in goto device output', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: async () => ({ device: {} }) })

  await t.throwsAsync(() => capture(page)('https://example.com'), {
    instanceOf: TypeError,
    message: /Expected `goto` to return `\{ device: \{ viewport \} \}`/
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

test('serializes setup when captures share the same browser', async t => {
  const createCapture = loadCapture()
  const browser = createWorkerBrowser({ chunks: [Buffer.from('shared')] })
  const enteredFirst = createDeferred()
  const releaseFirst = createDeferred()
  let secondBringToFrontCalls = 0

  const { page: firstPage } = createFixture({
    browser,
    bringToFront: async () => {
      enteredFirst.resolve()
      await releaseFirst.promise
    }
  })

  const { page: secondPage } = createFixture({
    browser,
    bringToFront: async () => {
      secondBringToFrontCalls++
    }
  })

  const capture = createCapture({ goto: createGoto() })

  const firstTask = capture(firstPage)('https://example.com/first', {
    duration: 20,
    frameSize: 10,
    audio: false,
    video: true
  })

  await enteredFirst.promise

  const secondTask = capture(secondPage)('https://example.com/second', {
    duration: 20,
    frameSize: 10,
    audio: false,
    video: true
  })

  const secondEnteredBeforeRelease = await waitUntil(() => secondBringToFrontCalls > 0, {
    timeout: 100
  })
  t.false(secondEnteredBeforeRelease)

  releaseFirst.resolve()

  const [firstBuffer, secondBuffer] = await Promise.all([firstTask, secondTask])
  t.true(Buffer.isBuffer(firstBuffer))
  t.true(Buffer.isBuffer(secondBuffer))
  t.is(secondBringToFrontCalls, 1)
})

test('allows setup in parallel when captures use different browsers', async t => {
  const createCapture = loadCapture()
  const enteredFirst = createDeferred()
  const releaseFirst = createDeferred()
  let secondBringToFrontCalls = 0

  const { page: firstPage } = createFixture({
    browser: createWorkerBrowser({ chunks: [Buffer.from('first')] }),
    bringToFront: async () => {
      enteredFirst.resolve()
      await releaseFirst.promise
    }
  })

  const { page: secondPage } = createFixture({
    browser: createWorkerBrowser({ chunks: [Buffer.from('second')] }),
    bringToFront: async () => {
      secondBringToFrontCalls++
    }
  })

  const capture = createCapture({ goto: createGoto() })

  const firstTask = capture(firstPage)('https://example.com/first-browser', {
    duration: 20,
    frameSize: 10,
    audio: false,
    video: true
  })

  await enteredFirst.promise

  const secondTask = capture(secondPage)('https://example.com/second-browser', {
    duration: 20,
    frameSize: 10,
    audio: false,
    video: true
  })

  const secondEnteredBeforeRelease = await waitUntil(() => secondBringToFrontCalls > 0)
  t.true(secondEnteredBeforeRelease)

  releaseFirst.resolve()

  const [firstBuffer, secondBuffer] = await Promise.all([firstTask, secondTask])
  t.true(Buffer.isBuffer(firstBuffer))
  t.true(Buffer.isBuffer(secondBuffer))
})

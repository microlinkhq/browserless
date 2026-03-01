'use strict'

const { EventEmitter } = require('events')
const fs = require('fs').promises
const path = require('path')
const test = require('ava')
const os = require('os')

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

const createExtension = ({
  chunks = [Buffer.from('a'), Buffer.from('b')],
  failGoto = false,
  hasTab = true
} = {}) => {
  let socket

  return {
    _closed: false,
    _port: undefined,
    async goto (url) {
      if (failGoto) throw new Error('ERR_BLOCKED_BY_CLIENT')
      this._port = Number(String(url).split('#').pop()) || undefined
    },
    async evaluate (fn, arg) {
      const source = fn.toString()

      if (
        source.includes('typeof globalThis.START_RECORDING') &&
        source.includes('typeof globalThis.STOP_RECORDING')
      ) {
        return true
      }
      if (source.includes('globalThis.chrome.tabs.query')) return hasTab ? [{ id: 1 }] : []

      if (source.includes('globalThis.START_RECORDING(settings)')) {
        const server = FakeWebSocketServer.byPort.get(this._port) || FakeWebSocketServer.latest
        socket = server.connect({ index: arg.index, chunks })
        return
      }

      if (source.includes('globalThis.STOP_RECORDING(index)')) {
        if (socket) socket.close()
        return
      }

      return undefined
    },
    isClosed () {
      return this._closed
    },
    async close () {
      this._closed = true
      if (socket) socket.close()
    }
  }
}

const createBrowser = opts => ({
  async newPage () {
    return createExtension(opts)
  }
})

const createFixture = ({
  chunks = [Buffer.from('a'), Buffer.from('b')],
  failGoto = false,
  hasTab = true,
  browser = createBrowser({ chunks, failGoto, hasTab }),
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
    goto: async (page, opts) => {
      gotoCalls.push({ page, opts })
      return {}
    }
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
    width: 800,
    height: 600,
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
  const originalBrowser = page.browser()
  const originalNewPage = originalBrowser.newPage

  originalBrowser.newPage = async () => {
    const extension = await originalNewPage.call(originalBrowser)
    const originalEvaluate = extension.evaluate.bind(extension)

    extension.evaluate = async (fn, arg) => {
      const source = fn.toString()
      if (source.includes('globalThis.START_RECORDING(settings)')) {
        startRecordingPayload = arg
      }
      return originalEvaluate(fn, arg)
    }

    return extension
  }

  const capture = createCapture({ goto: async () => ({}) })
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
  const originalBrowser = page.browser()
  const originalNewPage = originalBrowser.newPage

  originalBrowser.newPage = async () => {
    const extension = await originalNewPage.call(originalBrowser)
    const originalEvaluate = extension.evaluate.bind(extension)

    extension.evaluate = async (fn, arg) => {
      const source = fn.toString()
      if (source.includes('globalThis.START_RECORDING(settings)')) {
        startRecordingPayload = arg
      }
      return originalEvaluate(fn, arg)
    }

    return extension
  }

  const capture = createCapture({ goto: async () => ({}) })
  await capture(page)('https://example.com', { duration: 20, type: 'mp4' })

  t.is(startRecordingPayload.mimeType, 'video/mp4')
})

test('mimeType takes precedence over `type`', async t => {
  const createCapture = loadCapture()
  let startRecordingPayload

  const { page } = createFixture()
  const originalBrowser = page.browser()
  const originalNewPage = originalBrowser.newPage

  originalBrowser.newPage = async () => {
    const extension = await originalNewPage.call(originalBrowser)
    const originalEvaluate = extension.evaluate.bind(extension)

    extension.evaluate = async (fn, arg) => {
      const source = fn.toString()
      if (source.includes('globalThis.START_RECORDING(settings)')) {
        startRecordingPayload = arg
      }
      return originalEvaluate(fn, arg)
    }

    return extension
  }

  const capture = createCapture({ goto: async () => ({}) })
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
  const capture = createCapture({ goto: async () => ({}) })

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
  const capture = createCapture({ goto: async () => ({}) })

  await t.throwsAsync(() => capture(page)('https://example.com', { audio: false, video: false }), {
    instanceOf: TypeError,
    message: /At least one of `audio` or `video` must be true/
  })
})

test('rejects unsupported type', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture()
  const capture = createCapture({ goto: async () => ({}) })

  await t.throwsAsync(() => capture(page)('https://example.com', { type: 'avi' }), {
    instanceOf: TypeError,
    message: /Unsupported `type` "avi"/
  })
})

test('rejects when extension cannot be opened', async t => {
  const createCapture = loadCapture()
  const { page } = createFixture({ failGoto: true })
  const capture = createCapture({ goto: async () => ({}) })

  await t.throwsAsync(() => capture(page)('https://example.com', { duration: 20 }), {
    message: /Unable to open capture extension/
  })
})

test('serializes setup when captures share the same browser', async t => {
  const createCapture = loadCapture()
  const browser = createBrowser({ chunks: [Buffer.from('shared')] })
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

  const capture = createCapture({ goto: async () => ({}) })

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
    browser: createBrowser({ chunks: [Buffer.from('first')] }),
    bringToFront: async () => {
      enteredFirst.resolve()
      await releaseFirst.promise
    }
  })

  const { page: secondPage } = createFixture({
    browser: createBrowser({ chunks: [Buffer.from('second')] }),
    bringToFront: async () => {
      secondBringToFrontCalls++
    }
  })

  const capture = createCapture({ goto: async () => ({}) })

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

'use strict'

const createGoto = require('@browserless/goto')
const { WebSocketServer } = require('ws')
const path = require('path')
const fs = require('fs').promises

const EXTENSION_ID = 'jjndjgheafjngoipoacpjgeicjeomjli'
const EXTENSION_PATH = path.join(__dirname, '..', 'extension')

const NOOP = () => {}
const MIME_TYPES_BY_TYPE = Object.freeze({
  webm: {
    video: 'video/webm',
    audio: 'audio/webm'
  },
  mp4: {
    video: 'video/mp4',
    audio: 'audio/mp4'
  },
  mkv: {
    video: 'video/x-matroska;codecs=avc1'
  },
  matroska: {
    video: 'video/x-matroska;codecs=avc1'
  }
})

let currentIndex = 0
let mutex = false
const queue = []

const lock = () =>
  new Promise(resolve => {
    if (!mutex) {
      mutex = true
      return resolve()
    }

    queue.push(resolve)
  })

const unlock = () => {
  if (queue.length > 0) {
    queue.shift()()
  } else {
    mutex = false
  }
}

const abortError = () => {
  const error = new Error('The capture operation was aborted')
  error.name = 'AbortError'
  return error
}

const wait = (duration, signal) =>
  new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError())

    let isSettled = false

    const onAbort = () => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      reject(abortError())
    }

    const timer = setTimeout(() => {
      if (isSettled) return
      isSettled = true
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort)
      }
      resolve()
    }, duration)

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })

const assertPositive = (name, value) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`Expected \`${name}\` to be a number > 0. Received: ${value}`)
  }
}

const closeServer = wss =>
  new Promise(resolve => {
    if (!wss) return resolve()
    try {
      wss.close(() => resolve())
    } catch (error) {
      resolve()
    }
  })

const createWebSocketServer = () =>
  new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })

    const onListening = () => {
      cleanup()
      const { port } = wss.address()
      resolve({ wss, port })
    }

    const onError = error => {
      cleanup()
      reject(error)
    }

    const cleanup = () => {
      wss.removeListener('listening', onListening)
      wss.removeListener('error', onError)
    }

    wss.once('listening', onListening)
    wss.once('error', onError)
  })

const getTypeFromPath = outputPath => {
  if (!outputPath) return undefined

  const extension = path.extname(outputPath).toLowerCase().slice(1)

  if (extension === 'm4a') return 'mp4'
  if (extension === 'webm' || extension === 'mp4' || extension === 'mkv') return extension

  return undefined
}

const getMimeTypeFromType = ({ type, audio, video }) => {
  if (!type) return undefined

  const normalizedType = String(type).trim().toLowerCase().replace(/^\./, '')
  const mappedType = MIME_TYPES_BY_TYPE[normalizedType]

  if (!mappedType) {
    throw new TypeError(
      `Unsupported \`type\` "${type}". Supported types: ${Object.keys(MIME_TYPES_BY_TYPE).join(', ')}`
    )
  }

  if (video && mappedType.video) return mappedType.video
  if (audio && mappedType.audio) return mappedType.audio

  throw new TypeError(
    `Unsupported \`type\` "${type}" for the current capture mode (audio=${audio}, video=${video}).`
  )
}

const getDefaultMimeType = ({ type, mimeType, path: outputPath, audio, video }) => {
  if (mimeType) return mimeType

  const explicitTypeMime = getMimeTypeFromType({ type, audio, video })
  if (explicitTypeMime) return explicitTypeMime

  const pathTypeMime = getMimeTypeFromType({ type: getTypeFromPath(outputPath), audio, video })
  if (pathTypeMime) return pathTypeMime

  if (video) return 'video/webm'
  if (audio) return 'audio/webm'
  return 'video/webm'
}

const createRecordingSession = ({ wss, index, timeout }) =>
  new Promise((resolve, reject) => {
    let socket
    let isSettled = false

    const chunks = []

    const done = (error, value) => {
      if (isSettled) return
      isSettled = true
      clearTimeout(timer)
      wss.removeListener('connection', onConnection)

      if (socket) {
        socket.removeAllListeners('message')
        socket.removeAllListeners('close')
        socket.removeAllListeners('error')
      }

      if (error) return reject(error)
      resolve(value)
    }

    const onConnection = (ws, req) => {
      const url = new URL(req.url, 'ws://127.0.0.1')
      if (url.searchParams.get('index') !== String(index)) return

      socket = ws

      socket.on('message', data => {
        if (Buffer.isBuffer(data)) return chunks.push(data)
        chunks.push(Buffer.from(data))
      })

      socket.once('error', error => done(error))
      socket.once('close', () => done(null, Buffer.concat(chunks)))
    }

    const timer = setTimeout(() => {
      done(new Error(`Timed out waiting for stream data after ${timeout}ms`))
    }, timeout)

    wss.on('connection', onConnection)
  })

const invokeExtension = async page => {
  const isMac = process.platform === 'darwin'

  await page.keyboard.down(isMac ? 'Meta' : 'Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyY')
  await page.keyboard.up('Shift')
  await page.keyboard.up(isMac ? 'Meta' : 'Control')

  await wait(100)
}

const assertExtensionLoaded = async (extension, retryPolicy) => {
  const waitRetry = ms => new Promise(resolve => setTimeout(resolve, ms))

  for (let i = 0; i < retryPolicy.times; i++) {
    const isReady = await extension
      .evaluate(
        () =>
          typeof globalThis.START_RECORDING === 'function' &&
          typeof globalThis.STOP_RECORDING === 'function'
      )
      .catch(() => false)

    if (isReady) return

    await waitRetry(Math.pow(retryPolicy.each, i))
  }

  throw new Error('Could not find START_RECORDING in the extension context')
}

const fitViewportToScreen = async page => {
  const viewport = page.viewport && page.viewport()
  if (!viewport || typeof page.evaluate !== 'function' || typeof page.setViewport !== 'function') return

  const metrics = await page
    .evaluate(() => ({
      width: Math.round(window.screen.width || window.innerWidth || 0),
      height: Math.round(window.screen.height || window.innerHeight || 0),
      deviceScaleFactor: window.devicePixelRatio || 1
    }))
    .catch(() => null)

  if (!metrics || !metrics.width || !metrics.height) return

  if (viewport.width === metrics.width && viewport.height === metrics.height) return

  await page.setViewport({
    ...viewport,
    width: metrics.width,
    height: metrics.height,
    deviceScaleFactor: viewport.deviceScaleFactor || metrics.deviceScaleFactor
  })
}

const alignTabToViewport = async ({ page, extension, tab, viewport }) => {
  if (!tab || !tab.id || !viewport || !viewport.width || !viewport.height) return tab
  if (typeof page.target !== 'function') return tab

  const session = await page.target().createCDPSession().catch(() => null)
  if (!session) return tab

  const getTab = () =>
    extension
      .evaluate(tabId => globalThis.chrome.tabs.get(tabId), tab.id)
      .catch(() => null)

  try {
    let currentTab = (await getTab()) || tab
    const window = await session.send('Browser.getWindowForTarget').catch(() => null)

    if (!window || !window.windowId || !window.bounds) return currentTab

    const frameWidth = Math.max(0, (window.bounds.width || 0) - (currentTab.width || 0))
    const frameHeight = Math.max(0, (window.bounds.height || 0) - (currentTab.height || 0))

    const targetBounds = {
      width: Math.max(1, viewport.width + frameWidth),
      height: Math.max(1, viewport.height + frameHeight)
    }

    await session
      .send('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: targetBounds
      })
      .catch(() => null)

    currentTab = (await getTab()) || currentTab
    return currentTab
  } finally {
    await session.detach().catch(() => null)
  }
}

const getVideoConstraints = (page, videoConstraints, sourceViewport) => {
  if (videoConstraints) return videoConstraints

  const viewport = sourceViewport || (page.viewport && page.viewport())
  if (!viewport || !viewport.width || !viewport.height) return undefined

  const dpr = Math.max(Number(viewport.deviceScaleFactor) || 1, 1)
  const width = Math.round(viewport.width * dpr)
  const height = Math.round(viewport.height * dpr)

  return {
    mandatory: {
      minWidth: width,
      minHeight: height,
      maxWidth: width,
      maxHeight: height
    }
  }
}

const capturePage = async (page, opts = {}) => {
  if (!page || typeof page.browser !== 'function') {
    throw new TypeError('Expected a valid Puppeteer page instance as first argument')
  }

  const {
    path: outputPath,
    duration = 3000,
    timeout = Math.max(duration * 3, 30000),
    audio = false,
    video = true,
    frameSize = 20,
    audioBitsPerSecond,
    videoBitsPerSecond,
    bitsPerSecond,
    type,
    mimeType,
    delay,
    signal,
    tabQuery = { active: true },
    retry = {},
    videoConstraints,
    audioConstraints,
    __captureViewport
  } = opts

  if (!audio && !video) {
    throw new TypeError('At least one of `audio` or `video` must be true')
  }

  assertPositive('duration', duration)
  assertPositive('frameSize', frameSize)

  const retryPolicy = Object.assign({ each: 20, times: 3 }, retry)

  const browser = page.browser()
  const index = currentIndex++
  const streamMimeType = getDefaultMimeType({ type, mimeType, path: outputPath, audio, video })
  const resolvedVideoConstraints = getVideoConstraints(page, videoConstraints, __captureViewport)

  const { wss, port } = await createWebSocketServer()

  let extension
  let recordingPromise
  let isRecordingStarted = false
  let captureError
  let buffer = Buffer.alloc(0)

  try {
    extension = await browser.newPage()

    try {
      await extension.goto(`chrome-extension://${EXTENSION_ID}/options.html#${port}`, {
        waitUntil: 'domcontentloaded'
      })
    } catch (error) {
      throw new Error(
        `Unable to open capture extension. Launch Chromium with extension support using \`${EXTENSION_PATH}\`.`
      )
    }

    await lock()
    try {
      await page.bringToFront()
      await wait(100)

      const currentUrl = page.url()
      const tab = await extension.evaluate(
        async ({ query, currentUrl }) => {
          const queried = await globalThis.chrome.tabs.query(query)
          if (queried[0] && queried[0].url === currentUrl) return queried[0]

          const all = await globalThis.chrome.tabs.query({})
          return all.find(tab => tab.url === currentUrl) || queried[0]
        },
        { query: tabQuery, currentUrl }
      )

      if (!tab) {
        throw new Error('Cannot find the active tab. Try setting `opts.tabQuery`.')
      }

      if (tab.id) {
        await extension.evaluate(
          tabId => globalThis.chrome.tabs.update(tabId, { active: true }),
          tab.id
        )
        await wait(100)
      }

      const captureViewport = __captureViewport || (page.viewport && page.viewport())
      const alignedTab = await alignTabToViewport({
        page,
        extension,
        tab,
        viewport: captureViewport
      })

      await assertExtensionLoaded(extension, retryPolicy)
      await invokeExtension(page)

      recordingPromise = createRecordingSession({ wss, index, timeout })

      await extension.evaluate(settings => globalThis.START_RECORDING(settings), {
        index,
        tabId: alignedTab.id,
        video,
        audio,
        frameSize,
        mimeType: streamMimeType,
        audioBitsPerSecond,
        videoBitsPerSecond,
        bitsPerSecond,
        delay,
        videoConstraints: resolvedVideoConstraints,
        audioConstraints
      })

      isRecordingStarted = true
    } finally {
      unlock()
    }

    await wait(duration, signal)
  } catch (error) {
    captureError = error
  } finally {
    if (extension && !extension.isClosed()) {
      await extension.evaluate(index => globalThis.STOP_RECORDING(index), index).catch(NOOP)
    }

    if (recordingPromise) {
      if (isRecordingStarted) {
        buffer = await recordingPromise.catch(error => {
          if (!captureError) throw error
          return Buffer.alloc(0)
        })
      } else {
        recordingPromise.catch(NOOP)
      }
    }

    if (extension && !extension.isClosed()) {
      await extension.close().catch(NOOP)
    }

    await closeServer(wss)
  }

  if (captureError) throw captureError

  if (buffer.length === 0) {
    throw new Error(
      'No video data was captured. Increase `duration` or verify playback in the tab.'
    )
  }

  if (outputPath) await fs.writeFile(outputPath, buffer)

  return buffer
}

module.exports = ({ goto, ...gotoOpts } = {}) => {
  goto = goto || createGoto(gotoOpts)

  return function capture (page) {
    return async (url, { waitUntil = 'networkidle2', fitToScreen = true, ...opts } = {}) => {
      await goto(page, { ...opts, url, waitUntil })
      const captureViewport = page.viewport && page.viewport()
      if (fitToScreen) await fitViewportToScreen(page)
      return capturePage(page, { ...opts, __captureViewport: captureViewport })
    }
  }
}

module.exports.capturePage = capturePage
module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.types = Object.freeze(Object.keys(MIME_TYPES_BY_TYPE))

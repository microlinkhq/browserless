'use strict'

const createGoto = require('@browserless/goto')
const fs = require('fs').promises
const { withLock } = require('superlock')

const {
  DEFAULT_TAB_QUERY,
  DEFAULT_RETRY_POLICY,
  EXTENSION_PATH,
  EXTENSION_ID,
  TYPES
} = require('./constants')

const {
  NOOP,
  closeServer,
  createWebSocketServer,
  createRecordingSession,
  getDefaultMimeType,
  getVideoConstraints
} = require('./functions')

const {
  openExtension,
  getTab,
  activateTab,
  alignTabToViewport,
  assertExtensionLoaded,
  invokeExtension,
  startRecording,
  stopRecording
} = require('./extension')

let currentIndex = 0
const defaultLock = withLock()
const browserLocks = new WeakMap()

const getBrowserLock = browser => {
  if (!browser || (typeof browser !== 'object' && typeof browser !== 'function')) {
    return defaultLock
  }

  let lock = browserLocks.get(browser)

  if (!lock) {
    lock = withLock()
    browserLocks.set(browser, lock)
  }

  return lock
}

const abortError = () => {
  const error = new Error('The capture operation was aborted')
  error.name = 'AbortError'
  return error
}

const waitForCaptureDuration = (duration, signal) =>
  new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(abortError())

    const onAbort = () => {
      clearTimeout(timer)
      reject(abortError())
    }

    const timer = setTimeout(() => {
      if (signal && typeof signal.removeEventListener === 'function') {
        signal.removeEventListener('abort', onAbort)
      }
      resolve()
    }, duration)

    if (signal && typeof signal.addEventListener === 'function') {
      signal.addEventListener('abort', onAbort, { once: true })
    }
  })

// TODO: what is frame size
const capturePage = async (page, opts, viewport) => {
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
    tabQuery = DEFAULT_TAB_QUERY,
    retry = {},
    videoConstraints,
    audioConstraints
  } = opts

  if (!audio && !video) {
    throw new TypeError('At least one of `audio` or `video` must be true')
  }

  const retryPolicy = Object.assign({}, DEFAULT_RETRY_POLICY, retry)

  const browser = page.browser()
  const lock = getBrowserLock(browser)
  const index = currentIndex++

  const streamMimeType = getDefaultMimeType({
    type,
    mimeType,
    path: outputPath,
    audio,
    video
  })

  const resolvedVideoConstraints = getVideoConstraints(videoConstraints, viewport)

  const { wss, port } = await createWebSocketServer()

  let extension
  let recordingPromise
  let isRecordingStarted = false
  let captureError
  let buffer = Buffer.alloc(0)

  try {
    extension = await openExtension({ browser })

    await lock(async () => {
      await page.bringToFront()

      const tab = await getTab({
        extension,
        query: tabQuery,
        currentUrl: page.url()
      })

      if (!tab) {
        throw new Error('Cannot find the active tab. Try setting `opts.tabQuery`.')
      }

      await activateTab({ extension, tabId: tab.id })

      const alignedTab = await alignTabToViewport({
        page,
        extension,
        tab,
        viewport
      })

      await assertExtensionLoaded(extension, retryPolicy)
      await invokeExtension({ page })

      recordingPromise = createRecordingSession({ wss, index, timeout })

      await startRecording({
        extension,
        settings: {
          index,
          port,
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
        }
      })

      isRecordingStarted = true
    })

    await waitForCaptureDuration(duration, signal)
  } catch (error) {
    captureError = error
  } finally {
    if (extension && !extension.isClosed()) {
      await stopRecording({ extension, index }).catch(NOOP)
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
  return page => async (url, opts) => {
    const { device } = await goto(page, { ...opts, url })
    return capturePage(page, opts, device.viewport)
  }
}

module.exports.capturePage = capturePage
module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.types = TYPES

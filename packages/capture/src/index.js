'use strict'

const createGoto = require('@browserless/goto')
const fs = require('fs').promises
const { withLock } = require('superlock')

const {
  DEFAULT_RETRY_POLICY,
  EXTENSION_ID,
  EXTENSION_PATH,
  INTERNAL_FRAME_SIZE,
  NOOP,
  TAB_QUERY,
  TYPES
} = require('./constants')

const {
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

const waitForCaptureDuration = duration =>
  new Promise(resolve => {
    setTimeout(resolve, duration)
  })

const capturePage = async (page, opts, viewport) => {
  const {
    path: outputPath,
    duration = 3000,
    timeout = 30000,
    audio = false,
    video = true,
    audioBitsPerSecond,
    videoBitsPerSecond,
    bitsPerSecond,
    type,
    delay,
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
        query: TAB_QUERY,
        currentUrl: page.url()
      })

      if (!tab) {
        throw new Error('Cannot find the active tab.')
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
          frameSize: INTERNAL_FRAME_SIZE,
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

    await waitForCaptureDuration(duration)
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

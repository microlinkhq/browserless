'use strict'

const createGoto = require('@browserless/goto')
const fs = require('fs').promises

const {
  DEFAULT_TAB_QUERY,
  DEFAULT_RETRY_POLICY,
  DEFAULT_WAIT_UNTIL,
  EXTENSION_PATH,
  EXTENSION_ID,
  TYPES
} = require('./constants')

const {
  NOOP,
  createLock,
  wait,
  assertPositive,
  closeServer,
  createWebSocketServer,
  createRecordingSession,
  getDefaultMimeType,
  fitViewportToScreen,
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
const { lock, unlock } = createLock()

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
    tabQuery = DEFAULT_TAB_QUERY,
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

  const retryPolicy = Object.assign({}, DEFAULT_RETRY_POLICY, retry)

  const browser = page.browser()
  const index = currentIndex++

  const streamMimeType = getDefaultMimeType({
    type,
    mimeType,
    path: outputPath,
    audio,
    video
  })

  const resolvedVideoConstraints = getVideoConstraints(page, videoConstraints, __captureViewport)

  const { wss, port } = await createWebSocketServer()

  let extension
  let recordingPromise
  let isRecordingStarted = false
  let captureError
  let buffer = Buffer.alloc(0)

  try {
    extension = await openExtension({ browser, port })

    await lock()
    try {
      await page.bringToFront()
      await wait(100)

      const tab = await getTab({
        extension,
        query: tabQuery,
        currentUrl: page.url()
      })

      if (!tab) {
        throw new Error('Cannot find the active tab. Try setting `opts.tabQuery`.')
      }

      await activateTab({ extension, tabId: tab.id, wait })

      const captureViewport = __captureViewport || (page.viewport && page.viewport())
      const alignedTab = await alignTabToViewport({
        page,
        extension,
        tab,
        viewport: captureViewport
      })

      await assertExtensionLoaded(extension, retryPolicy)
      await invokeExtension({ page, wait })

      recordingPromise = createRecordingSession({ wss, index, timeout })

      await startRecording({
        extension,
        settings: {
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
        }
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

  return function capture (page) {
    return async (url, { waitUntil = DEFAULT_WAIT_UNTIL, fitToScreen = true, ...opts } = {}) => {
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
module.exports.types = TYPES

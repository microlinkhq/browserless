'use strict'

const createGoto = require('@browserless/goto')
const { withLock } = require('superlock')
const fs = require('fs/promises')

const {
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
  getMimeType,
  getVideoConstraints
} = require('./util')

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

const isTrackObject = value => value && typeof value === 'object' && !Array.isArray(value)

const getOpts = (value, defaultValue, name) => {
  const resolvedValue = value === undefined ? defaultValue : value

  if (typeof resolvedValue === 'boolean') {
    return {
      enabled: resolvedValue,
      constraints: undefined
    }
  }

  if (isTrackObject(resolvedValue)) {
    const constraints =
      Object.keys(resolvedValue).length === 0
        ? undefined
        : resolvedValue.constraints !== undefined
          ? resolvedValue.constraints
          : resolvedValue

    if (constraints !== undefined && !isTrackObject(constraints)) {
      throw new TypeError(`Expected \`${name}.constraints\` to be an object`)
    }

    return {
      enabled: true,
      constraints
    }
  }

  throw new TypeError(`Expected \`${name}\` to be a boolean or an object`)
}

const capturePage = async (page, opts, viewport) => {
  const { path: outputPath, duration = 3000, timeout = 30000, audio, video, type, delay } = opts

  const audioOpts = getOpts(audio, false, 'audio')

  const videoOpts = getOpts(video, true, 'video')

  if (!audioOpts.enabled && !videoOpts.enabled) {
    throw new TypeError('At least one of `audio` or `video` must be true')
  }

  const browser = page.browser()
  const lock = getBrowserLock(browser)
  const index = currentIndex++

  const streamMimeType = getMimeType({
    type,
    path: outputPath,
    audio: audioOpts.enabled,
    video: videoOpts.enabled
  })

  const resolvedVideoConstraints = getVideoConstraints(videoOpts.constraints, viewport)

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

      await assertExtensionLoaded(extension)
      await invokeExtension({ page })

      recordingPromise = createRecordingSession({ wss, index, timeout })

      await startRecording({
        extension,
        settings: {
          index,
          port,
          tabId: alignedTab.id,
          video: videoOpts.enabled,
          audio: audioOpts.enabled,
          frameSize: INTERNAL_FRAME_SIZE,
          mimeType: streamMimeType,
          delay,
          videoConstraints: resolvedVideoConstraints,
          audioConstraints: audioOpts.constraints
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
  return page =>
    async (url, opts = {}) => {
      const { retry: _retry, ...captureOpts } = opts
      const { device } = await goto(page, { ...captureOpts, url })
      return capturePage(page, captureOpts, device.viewport)
    }
}

module.exports.capturePage = capturePage
module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.types = TYPES

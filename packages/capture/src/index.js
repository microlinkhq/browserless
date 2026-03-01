'use strict'

const debug = require('debug-logfmt')('browserless:capture')
const { setTimeout } = require('timers/promises')
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

const browserExtension = require('./extension')

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
  const { path: outputPath, duration = 3000, audio, video, type, delay } = opts

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

  let debugDuration = debug.duration('createWebSocketServer')
  const { wss, port } = await createWebSocketServer()
  debugDuration()

  let extension
  let recordingPromise
  let isRecordingStarted = false
  let captureError
  let buffer = Buffer.alloc(0)

  try {
    debugDuration = debug.duration('openExtension')
    extension = await browserExtension.open({ browser })
    debugDuration()

    await lock(async () => {
      debugDuration = debug.duration('bringToFront')
      await page.bringToFront()
      debugDuration()

      debugDuration = debug.duration('getTab')
      const tab = await browserExtension.getTab({
        extension,
        query: TAB_QUERY,
        currentUrl: page.url()
      })
      debugDuration()

      if (!tab) {
        throw new Error('Cannot find the active tab.')
      }

      debugDuration = debug.duration('activateTab')
      await browserExtension.activateTab({ extension, tabId: tab.id })
      debugDuration()

      debugDuration = debug.duration('alignTabToViewport')
      const alignedTab = await browserExtension.alignTabToViewport({
        page,
        extension,
        tab,
        viewport
      })
      debugDuration()

      debugDuration = debug.duration('assertExtensionLoaded')
      await browserExtension.assertExtensionLoaded(extension)
      debugDuration()

      debugDuration = debug.duration('invokeExtension')
      await browserExtension.invoke({ page })
      debugDuration()

      recordingPromise = createRecordingSession({ wss, index })

      debugDuration = debug.duration('startRecording')
      await browserExtension.startRecording({
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
      debugDuration()
      isRecordingStarted = true
    })

    await setTimeout(duration)
  } catch (error) {
    captureError = error
  } finally {
    if (extension && !browserExtension.isClosed()) {
      await browserExtension.stopRecording({ extension, index }).catch(NOOP)
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

    if (extension && !browserExtension.isClosed()) {
      await browserExtension.close().catch(NOOP)
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
      const duration = debug.duration()
      const { device } = await goto(page, { ...opts, url })
      const result = await capturePage(page, opts, device.viewport)
      duration.info()
      return result
    }
}

module.exports.capturePage = capturePage
module.exports.extensionPath = EXTENSION_PATH
module.exports.extensionId = EXTENSION_ID
module.exports.types = TYPES

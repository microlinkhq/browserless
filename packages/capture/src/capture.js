'use strict'

const { setTimeout } = require('timers/promises')
const { withLock } = require('superlock')
const fs = require('fs/promises')
const path = require('path')

const { closeServer, createWebSocketServer } = require('./util')
const extension = require('./extension')

const { INTERNAL_FRAME_SIZE, MIME_TYPES_BY_TYPE, NOOP } = require('./constants')

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

const createRecordingSession = ({ wss, index }) => {
  const { promise, resolve, reject } = Promise.withResolvers()
  let socket
  let isSettled = false

  const chunks = []

  const done = (error, value) => {
    if (isSettled) return
    isSettled = true
    wss.removeListener('connection', onConnection)

    if (socket) {
      socket.removeAllListeners('message').removeAllListeners('close').removeAllListeners('error')
    }

    if (error) return reject(error)
    resolve(value)
  }

  const onConnection = (ws, req) => {
    const url = new URL(req.url, 'ws://127.0.0.1')
    if (url.searchParams.get('index') !== String(index)) return
    socket = ws
    socket
      .on('message', buffer => chunks.push(buffer))
      .once('error', error => done(error))
      .once('close', () => done(null, Buffer.concat(chunks)))
  }

  wss.on('connection', onConnection)

  return promise
}

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
      `Unsupported \`type\` "${type}". Supported types: ${Object.keys(MIME_TYPES_BY_TYPE).join(
        ', '
      )}`
    )
  }

  if (video && mappedType.video) return mappedType.video
  if (audio && mappedType.audio) return mappedType.audio

  throw new TypeError(
    `Unsupported \`type\` "${type}" for the current capture mode (audio=${audio}, video=${video}).`
  )
}

const getMimeType = ({ type, path: outputPath, audio, video }) => {
  const explicitTypeMime = getMimeTypeFromType({ type, audio, video })
  if (explicitTypeMime) return explicitTypeMime

  const pathTypeMime = getMimeTypeFromType({ type: getTypeFromPath(outputPath), audio, video })
  if (pathTypeMime) return pathTypeMime

  if (video) return 'video/webm'
  if (audio) return 'audio/webm'
  return 'video/webm'
}

const getVideoConstraints = (videoConstraints, viewport) => {
  if (videoConstraints) return videoConstraints

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

module.exports = async (page, opts, viewport) => {
  const { path: outputPath, duration = 3000, audio, video, type } = opts

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

  let worker
  let workerPromise
  let wss
  let port
  let recordingPromise
  let isRecordingStarted = false
  let captureError
  let buffer = Buffer.alloc(0)

  try {
    workerPromise = extension.open({ browser })
    ;({ wss, port } = await createWebSocketServer())
    worker = await workerPromise

    recordingPromise = createRecordingSession({ wss, index })

    await lock(async () => {
      await extension.startRecording({
        extension: worker,
        settings: {
          index,
          port,
          video: videoOpts.enabled,
          audio: audioOpts.enabled,
          frameSize: INTERNAL_FRAME_SIZE,
          mimeType: streamMimeType,
          videoConstraints: resolvedVideoConstraints,
          audioConstraints: audioOpts.constraints
        }
      })
      isRecordingStarted = true
    })
    await setTimeout(duration)
  } catch (error) {
    if (!worker && workerPromise) {
      worker = await workerPromise.catch(() => null)
    }
    captureError = error
  } finally {
    const isWorkerOpen = worker && typeof worker.isClosed === 'function' && !worker.isClosed()
    const stopPromise = isWorkerOpen
      ? extension.stopRecording({ extension: worker, index }).catch(NOOP)
      : Promise.resolve()

    if (recordingPromise) {
      if (isRecordingStarted) {
        const recordingResultPromise = recordingPromise.catch(error => {
          if (!captureError) throw error
          return Buffer.alloc(0)
        })
        const [, recordingResult] = await Promise.all([stopPromise, recordingResultPromise])
        buffer = recordingResult
      } else {
        recordingPromise.catch(NOOP)
        await stopPromise
      }
    } else {
      await stopPromise
    }

    const closeTasks = [closeServer(wss)]

    if (worker && typeof worker.isClosed === 'function' && !worker.isClosed()) {
      closeTasks.push(worker.close().catch(NOOP))
    }

    await Promise.all(closeTasks)
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

'use strict'

const { setTimeout } = require('timers/promises')
const fs = require('fs/promises')
const debug = require('debug-logfmt')('browserless:capture')

const { closeServer, createWebSocketServer } = require('./util')
const extension = require('./extension')

const { INTERNAL_FRAME_SIZE, NOOP } = require('./constants')

let currentIndex = 0

const runWithDuration = async (label, fn, fields) => {
  const duration = debug.duration(label)

  try {
    const value = await fn()
    duration(fields)
    return value
  } catch (error) {
    duration({
      ...(fields || {}),
      error: error && error.message
    })
    throw error
  }
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

const MIME_TYPES_BY_TYPE = Object.freeze({
  webm: Object.freeze({
    video: 'video/webm',
    audio: 'audio/webm'
  }),
  mp4: Object.freeze({
    video: 'video/mp4',
    audio: 'audio/mp4'
  })
})

const SUPPORTED_TYPES = Object.freeze(Object.keys(MIME_TYPES_BY_TYPE))

const getMimeType = ({ type, audio, video }) => {
  const normalizedType =
    type === undefined || type === null
      ? 'webm'
      : String(type).trim().toLowerCase().replace(/^\./, '')

  const mimeTypes = MIME_TYPES_BY_TYPE[normalizedType]

  if (!mimeTypes) {
    throw new TypeError(
      `Unsupported \`type\` "${type}". Supported types: ${SUPPORTED_TYPES.join(', ')}.`
    )
  }

  return audio && !video ? mimeTypes.audio : mimeTypes.video
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

const getTargetId = async page => {
  if (!page || typeof page.target !== 'function') return

  const target = page.target()
  if (!target || typeof target.createCDPSession !== 'function') return

  const session = await target.createCDPSession().catch(NOOP)
  if (!session) return

  try {
    const result = await session.send('Target.getTargetInfo').catch(NOOP)
    return result && result.targetInfo && result.targetInfo.targetId
  } finally {
    await session.detach().catch(NOOP)
  }
}

module.exports = async (page, opts, viewport) => {
  const { path: outputPath, duration = 3000, audio, video, type } = opts

  const audioOpts = getOpts(audio, false, 'audio')
  const videoOpts = getOpts(video, true, 'video')

  if (!audioOpts.enabled && !videoOpts.enabled) {
    throw new TypeError('At least one of `audio` or `video` must be true')
  }

  const browser = page.browser()
  const index = currentIndex++

  const streamMimeType = getMimeType({
    type,
    audio: audioOpts.enabled,
    video: videoOpts.enabled
  })

  const resolvedVideoConstraints = getVideoConstraints(videoOpts.constraints, viewport)

  let worker
  let workerPromise
  let wsServerPromise
  let wss
  let port
  let recordingPromise
  let isRecordingStarted = false
  let captureError
  let buffer = Buffer.alloc(0)
  let targetId

  try {
    const targetIdPromise = runWithDuration('getPageTargetId', () => getTargetId(page))
    workerPromise = runWithDuration('extension.open', () => extension.open({ browser }))
    wsServerPromise = runWithDuration('createWebSocketServer', () => createWebSocketServer())

    const [_targetId, _worker, wsServer] = await Promise.all([
      targetIdPromise,
      workerPromise,
      wsServerPromise
    ])

    targetId = _targetId
    worker = _worker
    ;({ wss, port } = wsServer)
    if (!targetId) throw new Error('Cannot resolve page target id.')

    recordingPromise = createRecordingSession({ wss, index })

    const tabId = await runWithDuration(
      'extension.getTabIdFromTargetId',
      () =>
        extension.getTabIdFromTargetId({
          worker,
          targetId
        }),
      { targetId }
    )
    if (!Number.isInteger(tabId)) {
      throw new Error('Cannot resolve tab id for the current page target.')
    }

    await runWithDuration(
      'extension.startRecording',
      () =>
        extension.startRecording({
          extension: worker,
          settings: {
            index,
            port,
            tabId,
            video: videoOpts.enabled,
            audio: audioOpts.enabled,
            frameSize: INTERNAL_FRAME_SIZE,
            mimeType: streamMimeType,
            videoConstraints: resolvedVideoConstraints,
            audioConstraints: audioOpts.constraints
          }
        }),
      { index, tabId }
    )
    isRecordingStarted = true
    await runWithDuration('durationwait', () => setTimeout(duration), { duration })
  } catch (error) {
    if (!worker && workerPromise) {
      worker = await runWithDuration('awaitWorkerAfterError', () => workerPromise.catch(NOOP))
    }
    if (!wss && wsServerPromise) {
      ;({ wss, port } =
        (await runWithDuration('awaitWebSocketServerAfterError', () =>
          wsServerPromise.catch(NOOP)
        )) || {})
    }
    captureError = error
  } finally {
    const stopPromise = worker
      ? runWithDuration(
        'extension.stopRecording',
        () => extension.stopRecording({ extension: worker, index }).catch(NOOP),
        { index }
      )
      : Promise.resolve()

    if (recordingPromise) {
      if (isRecordingStarted) {
        const recordingResultPromise = recordingPromise.catch(error => {
          if (!captureError) throw error
          return Buffer.alloc(0)
        })
        const [, recordingResult] = await runWithDuration('stop+recordingPromise', () =>
          Promise.all([stopPromise, recordingResultPromise])
        )
        buffer = recordingResult
      } else {
        recordingPromise.catch(NOOP)
        await runWithDuration('stopWithoutRecording', () => stopPromise)
      }
    } else {
      await runWithDuration('stopWithoutPromise', () => stopPromise)
    }

    await runWithDuration('closeServer', () => closeServer(wss))
  }

  if (captureError) throw captureError

  if (buffer.length === 0) {
    throw new Error(
      'No video data was captured. Increase `duration` or verify playback in the tab.'
    )
  }

  if (outputPath) {
    await runWithDuration('writeFile', () => fs.writeFile(outputPath, buffer), {
      outputPath,
      bytes: buffer.length
    })
  }

  return buffer
}

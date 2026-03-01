'use strict'

const path = require('path')
const { WebSocketServer } = require('ws')

const { MIME_TYPES_BY_TYPE } = require('./constants')

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

const getDefaultMimeType = ({ type, path: outputPath, audio, video }) => {
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

module.exports = {
  closeServer,
  createWebSocketServer,
  createRecordingSession,
  getDefaultMimeType,
  getVideoConstraints
}

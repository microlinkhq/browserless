/* global chrome, WebSocket, MediaRecorder, navigator */

const MESSAGE_KEY = '__browserless_capture__'
const SOCKET_CONNECT_TIMEOUT = 10_000
const recorders = {}

const toErrorMessage = error => {
  if (typeof error === 'string') return error
  if (error && typeof error.message === 'string') return error.message
  return 'Unknown extension error'
}

const waitForSocketOpen = client =>
  new Promise((resolve, reject) => {
    if (client.readyState === WebSocket.OPEN) return resolve()

    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`Timed out opening websocket after ${SOCKET_CONNECT_TIMEOUT}ms`))
    }, SOCKET_CONNECT_TIMEOUT)

    const cleanup = () => {
      clearTimeout(timer)
      client.removeEventListener('open', onOpen)
      client.removeEventListener('error', onError)
      client.removeEventListener('close', onClose)
    }

    const onOpen = () => {
      cleanup()
      resolve()
    }

    const onError = () => {
      cleanup()
      reject(new Error('Unable to connect to websocket recorder endpoint'))
    }

    const onClose = () => {
      cleanup()
      reject(new Error('Websocket recorder endpoint closed before opening'))
    }

    client.addEventListener('open', onOpen, { once: true })
    client.addEventListener('error', onError, { once: true })
    client.addEventListener('close', onClose, { once: true })
  })

const buildTrackConstraints = ({ streamId, constraints }) => {
  const source = constraints && typeof constraints === 'object' ? constraints : {}
  const mandatory = source.mandatory && typeof source.mandatory === 'object' ? source.mandatory : {}
  const { mandatory: _mandatory, ...rest } = source

  return {
    ...rest,
    mandatory: {
      ...mandatory,
      chromeMediaSource: 'tab',
      chromeMediaSourceId: streamId
    }
  }
}

const START_RECORDING = async ({
  index,
  port,
  streamId,
  video,
  audio,
  frameSize,
  mimeType,
  videoConstraints,
  audioConstraints
}) => {
  if (!port) throw new Error('Missing websocket port for recording session.')
  if (!streamId) throw new Error('Missing tab media stream id for recording session.')

  const client = new WebSocket(`ws://localhost:${port}/?index=${index}`, [])
  await waitForSocketOpen(client)

  let audioStreamConstraints = false
  let videoStreamConstraints = false

  if (audio) {
    audioStreamConstraints = buildTrackConstraints({
      streamId,
      constraints: audioConstraints
    })
  }

  if (video) {
    videoStreamConstraints = buildTrackConstraints({
      streamId,
      constraints: videoConstraints
    })
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: audioStreamConstraints,
    video: videoStreamConstraints
  })

  const recorderOptions = {
    mimeType
  }

  const recorder = new MediaRecorder(stream, recorderOptions)

  const pending = new Set()

  recorder.ondataavailable = event => {
    if (!event.data.size) return

    const task = (async () => {
      const buffer = await event.data.arrayBuffer()
      if (client.readyState === WebSocket.OPEN) client.send(buffer)
    })()

    pending.add(task)
    task.finally(() => pending.delete(task))
  }

  recorder.onerror = () => recorder.stop()

  recorder.onstop = async () => {
    await Promise.allSettled(pending)
    stream.getTracks().forEach(track => track.stop())
    if (client.readyState === WebSocket.OPEN) client.close()
    delete recorders[index]
  }

  stream.onremovetrack = () => {
    try {
      recorder.stop()
    } catch (error) {}
  }

  recorders[index] = recorder
  recorder.start(frameSize)
}

const STOP_RECORDING = index => {
  const recorder = recorders[index]
  if (!recorder || recorder.state === 'inactive') return
  recorder.stop()
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message[MESSAGE_KEY]) return

  if (message.action === 'START_RECORDING') {
    START_RECORDING(message.settings)
      .then(value => sendResponse({ ok: true, value }))
      .catch(error => sendResponse({ ok: false, error: toErrorMessage(error) }))
    return true
  }

  if (message.action === 'STOP_RECORDING') {
    Promise.resolve()
      .then(() => STOP_RECORDING(message.index))
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: toErrorMessage(error) }))
    return true
  }
})

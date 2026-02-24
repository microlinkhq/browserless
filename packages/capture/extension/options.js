/* global chrome, window, WebSocket, MediaRecorder */

const recorders = {}

const START_RECORDING = async ({
  index,
  video,
  audio,
  frameSize,
  audioBitsPerSecond,
  videoBitsPerSecond,
  bitsPerSecond,
  mimeType,
  videoConstraints,
  audioConstraints
}) => {
  const client = new WebSocket(`ws://localhost:${window.location.hash.slice(1)}/?index=${index}`, [])

  await new Promise(resolve => {
    if (client.readyState === WebSocket.OPEN) return resolve()
    client.addEventListener('open', () => resolve(), { once: true })
  })

  const stream = await new Promise((resolve, reject) => {
    chrome.tabCapture.capture(
      {
        audio,
        video,
        audioConstraints,
        videoConstraints
      },
      stream => {
        if (chrome.runtime.lastError || !stream) {
          return reject(chrome.runtime.lastError?.message || 'Unable to start tab capture')
        }

        resolve(stream)
      }
    )
  })

  const recorder = new MediaRecorder(stream, {
    audioBitsPerSecond,
    videoBitsPerSecond,
    bitsPerSecond,
    mimeType
  })
  const pending = []

  recorder.ondataavailable = async event => {
    if (!event.data.size) return
    const task = (async () => {
      const buffer = await event.data.arrayBuffer()
      if (client.readyState === WebSocket.OPEN) client.send(buffer)
    })()

    pending.push(task)
    task.finally(() => {
      const index = pending.indexOf(task)
      if (index !== -1) pending.splice(index, 1)
    })
  }

  recorder.onerror = () => recorder.stop()

  recorder.onstop = async () => {
    try {
      await Promise.allSettled(pending)
      stream.getTracks().forEach(track => track.stop())
      if (client.readyState === WebSocket.OPEN) client.close()
    } catch (error) {}
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
  if (!recorders[index]) return
  if (recorders[index].state === 'inactive') return
  recorders[index].stop()
}

globalThis.START_RECORDING = START_RECORDING
globalThis.STOP_RECORDING = STOP_RECORDING

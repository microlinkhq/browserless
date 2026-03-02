/* global chrome */

const MESSAGE_KEY = '__browserless_capture__'
const OFFSCREEN_PATH = 'offscreen.html'
const MESSAGE_TIMEOUT = 10_000

const sendToOffscreen = payload =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for offscreen response after ${MESSAGE_TIMEOUT}ms`))
    }, MESSAGE_TIMEOUT)

    const done = callback => value => {
      clearTimeout(timer)
      callback(value)
    }

    chrome.runtime.sendMessage(
      {
        [MESSAGE_KEY]: true,
        ...payload
      },
      done(response => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message))
        }

        if (!response || !response.ok) {
          return reject(new Error((response && response.error) || 'No response from offscreen.'))
        }

        resolve(response.value)
      })
    )
  })

const getMediaStreamId = () =>
  new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({}, streamId => {
      if (chrome.runtime.lastError || !streamId) {
        return reject(
          new Error(chrome.runtime.lastError?.message || 'Unable to obtain tab media stream id')
        )
      }

      resolve(streamId)
    })
  })

const ensureOffscreenDocument = async () => {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') return

  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH)
  let contexts = []

  if (typeof chrome.runtime.getContexts === 'function') {
    contexts = await chrome.runtime
      .getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      })
      .catch(() => [])
  }

  if (contexts.length > 0) return

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_PATH,
    reasons: ['USER_MEDIA'],
    justification: 'Record tab media without opening a visible extension tab.'
  })
}

globalThis.START_RECORDING = async settings => {
  const [streamId] = await Promise.all([getMediaStreamId(), ensureOffscreenDocument()])
  return sendToOffscreen({
    action: 'START_RECORDING',
    settings: { ...settings, streamId }
  })
}

globalThis.STOP_RECORDING = async index => {
  try {
    await sendToOffscreen({ action: 'STOP_RECORDING', index })
  } catch (error) {}
}

/* global chrome */

const MESSAGE_KEY = '__browserless_capture__'
const OFFSCREEN_PATH = 'offscreen.html'
const MESSAGE_TIMEOUT = 10_000
const OFFSCREEN_ALREADY_EXISTS_RE = /already exists|single offscreen document/i

let offscreenDocumentPromise

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

const getMediaStreamId = tabId =>
  new Promise((resolve, reject) => {
    if (!Number.isInteger(tabId)) {
      reject(new TypeError('Missing tab id for recording session.'))
      return
    }

    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, streamId => {
      if (chrome.runtime.lastError || !streamId) {
        return reject(
          new Error(chrome.runtime.lastError?.message || 'Unable to obtain tab media stream id')
        )
      }

      resolve(streamId)
    })
  })

const getOffscreenContexts = async offscreenUrl => {
  if (typeof chrome.runtime.getContexts !== 'function') return []
  return chrome.runtime
    .getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    })
    .catch(() => [])
}

const ensureOffscreenDocument = async () => {
  if (!chrome.offscreen || typeof chrome.offscreen.createDocument !== 'function') return
  if (offscreenDocumentPromise) return offscreenDocumentPromise

  offscreenDocumentPromise = (async () => {
    const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH)
    const contexts = await getOffscreenContexts(offscreenUrl)
    if (contexts.length > 0) return

    try {
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_PATH,
        reasons: ['USER_MEDIA'],
        justification: 'Record tab media without opening a visible extension tab.'
      })
    } catch (error) {
      if (OFFSCREEN_ALREADY_EXISTS_RE.test(error?.message || '')) return

      const refreshedContexts = await getOffscreenContexts(offscreenUrl)
      if (refreshedContexts.length > 0) return

      throw error
    }
  })()

  try {
    await offscreenDocumentPromise
  } finally {
    offscreenDocumentPromise = undefined
  }
}

globalThis.START_RECORDING = async settings => {
  const [streamId] = await Promise.all([
    getMediaStreamId(settings && settings.tabId),
    ensureOffscreenDocument()
  ])
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

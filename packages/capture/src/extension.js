'use strict'

const { EXTENSION_ID, EXTENSION_PATH } = require('./constants')

const BACKGROUND_PATH = `chrome-extension://${EXTENSION_ID}/background.js`

const createWorkerRuntime = browser => {
  let isClosed = false

  const findWorkerTarget = () => {
    if (!browser || typeof browser.targets !== 'function') return
    return browser
      .targets()
      .find(target => target.type() === 'service_worker' && target.url() === BACKGROUND_PATH)
  }

  const getWorker = async () => {
    if (isClosed) return

    let target = findWorkerTarget()

    if (!target && typeof browser.waitForTarget === 'function') {
      target = await browser
        .waitForTarget(
          target => target.type() === 'service_worker' && target.url() === BACKGROUND_PATH,
          { timeout: 1000 }
        )
        .catch(() => null)
    }

    if (!target || typeof target.worker !== 'function') return
    return target.worker().catch(() => null)
  }

  const evaluate = async (fn, arg) => {
    const worker = await getWorker()
    if (!worker || typeof worker.evaluate !== 'function') {
      throw new Error('Unable to access capture extension service worker runtime.')
    }
    return worker.evaluate(fn, arg)
  }

  return {
    evaluate,
    isClosed: () => isClosed,
    close: async () => {
      isClosed = true
    }
  }
}

const open = async ({ browser }) => {
  const workerRuntime = createWorkerRuntime(browser)
  const isWorkerReady = await workerRuntime
    .evaluate(
      () =>
        typeof globalThis.START_RECORDING === 'function' &&
        typeof globalThis.STOP_RECORDING === 'function'
    )
    .catch(() => false)

  if (!isWorkerReady) {
    throw new Error(
      `Unable to connect to capture extension service worker. Launch Chromium with extension support using \`${EXTENSION_PATH}\`.`
    )
  }

  return workerRuntime
}

const getTab = async ({ worker }) => {
  try {
    return worker.evaluate(async () => {
      const queried = await globalThis.chrome.tabs.query({ active: true })
      return queried[0] || null
    })
  } catch (error) {
    return null
  }
}

const startRecording = async ({ extension, settings }) =>
  extension.evaluate(settings => globalThis.START_RECORDING(settings), settings)

const stopRecording = async ({ extension, index }) =>
  extension.evaluate(index => globalThis.STOP_RECORDING(index), index)

module.exports = {
  open,
  getTab,
  startRecording,
  stopRecording
}

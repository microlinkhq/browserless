'use strict'

const { EXTENSION_ID, EXTENSION_PATH, NOOP } = require('./constants')

const BACKGROUND_PATH = `chrome-extension://${EXTENSION_ID}/background.js`
const workerRuntimes = new WeakMap()
const openingWorkerRuntimes = new WeakMap()

const isCacheableBrowser = browser =>
  browser && (typeof browser === 'object' || typeof browser === 'function')

const createWorkerRuntime = browser => {
  const findWorkerTarget = () => {
    if (!browser || typeof browser.targets !== 'function') return
    return browser
      .targets()
      .find(target => target.type() === 'service_worker' && target.url() === BACKGROUND_PATH)
  }

  const getWorker = async () => {
    let target = findWorkerTarget()

    if (!target && typeof browser.waitForTarget === 'function') {
      target = await browser
        .waitForTarget(
          target => target.type() === 'service_worker' && target.url() === BACKGROUND_PATH,
          { timeout: 1000 }
        )
        .catch(NOOP)
    }

    if (!target || typeof target.worker !== 'function') return
    return target.worker().catch(NOOP)
  }

  const evaluate = async (fn, arg) => {
    const worker = await getWorker()
    if (!worker || typeof worker.evaluate !== 'function') {
      throw new Error('Unable to access capture extension service worker runtime.')
    }
    return worker.evaluate(fn, arg)
  }

  return {
    evaluate
  }
}

const open = async ({ browser }) => {
  if (isCacheableBrowser(browser)) {
    const cachedRuntime = workerRuntimes.get(browser)
    if (cachedRuntime) return cachedRuntime

    const cachedOpening = openingWorkerRuntimes.get(browser)
    if (cachedOpening) return cachedOpening
  }

  const openPromise = (async () => {
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

    if (isCacheableBrowser(browser)) workerRuntimes.set(browser, workerRuntime)
    return workerRuntime
  })()

  if (isCacheableBrowser(browser)) {
    openingWorkerRuntimes.set(browser, openPromise)
  }

  try {
    return await openPromise
  } finally {
    if (isCacheableBrowser(browser)) openingWorkerRuntimes.delete(browser)
  }
}

const getTabIdFromTargetId = async ({ worker, targetId }) => {
  try {
    return worker.evaluate(async targetId => {
      if (
        !globalThis.chrome.debugger ||
        typeof globalThis.chrome.debugger.getTargets !== 'function'
      ) {
        return
      }

      const targets = await globalThis.chrome.debugger.getTargets()
      const target = targets.find(target => target && target.id === targetId)
      return Number.isInteger(target && target.tabId) ? target.tabId : undefined
    }, targetId)
  } catch (_) {}
}

const startRecording = async ({ extension, settings }) =>
  extension.evaluate(settings => globalThis.START_RECORDING(settings), settings)

const stopRecording = async ({ extension, index }) =>
  extension.evaluate(index => globalThis.STOP_RECORDING(index), index)

module.exports = {
  open,
  getTabIdFromTargetId,
  startRecording,
  stopRecording
}

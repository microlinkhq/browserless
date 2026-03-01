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

const invokeExtension = async ({ page }) => {
  const isMac = process.platform === 'darwin'

  await page.keyboard.down(isMac ? 'Meta' : 'Control')
  await page.keyboard.down('Shift')
  await page.keyboard.press('KeyY')
  await page.keyboard.up('Shift')
  await page.keyboard.up(isMac ? 'Meta' : 'Control')
}

const assertExtensionLoaded = async (extension, retryPolicy) => {
  const waitRetry = ms => new Promise(resolve => setTimeout(resolve, ms))

  for (let i = 0; i < retryPolicy.times; i++) {
    const isReady = await extension
      .evaluate(
        () =>
          typeof globalThis.START_RECORDING === 'function' &&
          typeof globalThis.STOP_RECORDING === 'function'
      )
      .catch(() => false)

    if (isReady) return

    await waitRetry(Math.pow(retryPolicy.each, i))
  }

  throw new Error('Could not find START_RECORDING in the extension context')
}

const openExtension = async ({ browser }) => {
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

const getTab = async ({ extension, query, currentUrl }) => {
  try {
    return extension.evaluate(
      async ({ query, currentUrl }) => {
        const queried = await globalThis.chrome.tabs.query(query)
        if (queried[0] && queried[0].url === currentUrl) return queried[0]

        const all = await globalThis.chrome.tabs.query({})
        return all.find(tab => tab.url === currentUrl) || queried[0]
      },
      { query, currentUrl }
    )
  } catch (error) {
    return null
  }
}

const activateTab = async ({ extension, tabId }) => {
  if (!tabId) return

  await extension.evaluate(tabId => globalThis.chrome.tabs.update(tabId, { active: true }), tabId)
}

const alignTabToViewport = async ({ page, extension, tab, viewport }) => {
  if (!tab || !tab.id || !viewport || !viewport.width || !viewport.height) return tab
  if (typeof page.target !== 'function') return tab

  const session = await page
    .target()
    .createCDPSession()
    .catch(() => null)
  if (!session) return tab

  const getCurrentTab = () =>
    extension.evaluate(tabId => globalThis.chrome.tabs.get(tabId), tab.id).catch(() => null)

  try {
    let currentTab = (await getCurrentTab()) || tab
    const window = await session.send('Browser.getWindowForTarget').catch(() => null)

    if (!window || !window.windowId || !window.bounds) return currentTab

    const frameWidth = Math.max(0, (window.bounds.width || 0) - (currentTab.width || 0))
    const frameHeight = Math.max(0, (window.bounds.height || 0) - (currentTab.height || 0))

    const targetBounds = {
      width: Math.max(1, viewport.width + frameWidth),
      height: Math.max(1, viewport.height + frameHeight)
    }

    await session
      .send('Browser.setWindowBounds', {
        windowId: window.windowId,
        bounds: targetBounds
      })
      .catch(() => null)

    currentTab = (await getCurrentTab()) || currentTab
    return currentTab
  } finally {
    await session.detach().catch(() => null)
  }
}

const startRecording = async ({ extension, settings }) =>
  extension.evaluate(settings => globalThis.START_RECORDING(settings), settings)

const stopRecording = async ({ extension, index }) =>
  extension.evaluate(index => globalThis.STOP_RECORDING(index), index)

module.exports = {
  invokeExtension,
  assertExtensionLoaded,
  openExtension,
  getTab,
  activateTab,
  alignTabToViewport,
  startRecording,
  stopRecording
}

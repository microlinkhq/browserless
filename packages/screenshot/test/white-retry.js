'use strict'

const { setTimeout: delay } = require('node:timers/promises')
const test = require('ava')

const screenshotModulePath = require.resolve('../src/index.js')
const isWhiteModulePath = require.resolve('../src/is-white-screenshot.js')

const loadCreateScreenshot = isWhiteScreenshotMock => {
  const originalScreenshotModule = require.cache[screenshotModulePath]
  const originalIsWhiteModule = require.cache[isWhiteModulePath]

  delete require.cache[screenshotModulePath]
  require.cache[isWhiteModulePath] = {
    id: isWhiteModulePath,
    filename: isWhiteModulePath,
    loaded: true,
    exports: isWhiteScreenshotMock
  }

  const createScreenshot = require('../src')

  const restore = () => {
    delete require.cache[screenshotModulePath]
    if (originalScreenshotModule) {
      require.cache[screenshotModulePath] = originalScreenshotModule
    }

    if (originalIsWhiteModule) {
      require.cache[isWhiteModulePath] = originalIsWhiteModule
    } else {
      delete require.cache[isWhiteModulePath]
    }
  }

  return { createScreenshot, restore }
}

const createGoto = ({ timeout = 1000, waitUntilAutoDelay = 0 } = {}) => {
  let waitUntilAutoCalls = 0

  const goto = async (_page, { waitUntilAuto } = {}) => {
    if (waitUntilAuto) await waitUntilAuto(_page, { response: { headers: () => ({}) } })
    return { response: { headers: () => ({}) } }
  }

  goto.run = async ({ fn }) => ({ isRejected: false, value: await fn })
  goto.timeouts = { action: () => timeout, goto: () => timeout }
  goto.waitUntilAuto = async () => {
    waitUntilAutoCalls += 1
    if (waitUntilAutoDelay) await delay(waitUntilAutoDelay)
  }
  goto.getWaitUntilAutoCalls = () => waitUntilAutoCalls

  return goto
}

const createPage = (screenshots, { pageSnapshots = [] } = {}) => {
  let screenshotCalls = 0
  let pageSnapshotCall = 0

  return {
    on: () => {},
    off: () => {},
    evaluate: async expression => {
      if (expression === 'document.fonts.ready') return undefined
      if (typeof expression === 'function') {
        const source = expression.toString()
        const isSnapshotEval =
          source.includes('document.title') &&
          source.includes('document.body') &&
          source.includes('window.location.href')

        if (!isSnapshotEval) return undefined

        return (
          pageSnapshots[pageSnapshotCall++] || {
            title: '',
            bodyText: '',
            url: 'https://example.com'
          }
        )
      }
      return undefined
    },
    $$eval: async () => undefined,
    screenshot: async () => screenshots[screenshotCalls++],
    getScreenshotCalls: () => screenshotCalls
  }
}

test('retries white screenshots until non-white image', async t => {
  const responses = [true, true, false]
  const isWhiteScreenshotMock = async () => responses.shift() ?? false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto()
  const screenshots = [Buffer.from('shot1'), Buffer.from('shot2'), Buffer.from('shot3')]
  const page = createPage(screenshots)
  const screenshot = createScreenshot({ goto })(page)

  const result = await screenshot('https://example.com', { waitUntil: 'auto', codeScheme: false })

  t.deepEqual(result, screenshots[2])
  t.is(goto.getWaitUntilAutoCalls(), 2)
})

test('stops white screenshot retries after timeout', async t => {
  const isWhiteScreenshotMock = async () => true
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto({ timeout: 25, waitUntilAutoDelay: 10 })
  const screenshots = Array.from({ length: 10 }, (_, index) => Buffer.from(`shot${index}`))
  const page = createPage(screenshots)
  const screenshot = createScreenshot({ goto })(page)

  const result = await screenshot('https://example.com', { waitUntil: 'auto', codeScheme: false })

  t.true(Buffer.isBuffer(result))
  t.true(goto.getWaitUntilAutoCalls() >= 1)
  t.is(page.getScreenshotCalls(), goto.getWaitUntilAutoCalls() + 1)
})

test('waits for verification interstitial to resolve before screenshot', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto({ timeout: 10000 })
  const screenshots = [Buffer.from('shot1'), Buffer.from('shot2'), Buffer.from('shot3')]
  const page = createPage(screenshots, {
    pageSnapshots: [
      {
        title: 'Verifying you are human',
        bodyText: 'Please wait while we verify that you are not a robot.',
        url: 'https://augen.pro/'
      },
      {
        title: 'Verifying you are human',
        bodyText: 'Please wait while we verify that you are not a robot.',
        url: 'https://augen.pro/'
      },
      {
        title: 'AUGEN',
        bodyText: 'Beyond Humanware.',
        url: 'https://augen.pro/'
      }
    ]
  })

  const screenshot = createScreenshot({ goto })(page)
  const result = await screenshot('https://example.com', {
    waitUntil: 'auto',
    codeScheme: false,
    isPageReady: ({ title = '', bodyText = '', url = '' } = {}) => {
      const haystack = `${title}\n${bodyText}\n${url}`.toLowerCase()
      return !haystack.includes('verifying you are human')
    }
  })

  t.deepEqual(result, screenshots[2])
  t.is(goto.getWaitUntilAutoCalls(), 2)
  t.is(page.getScreenshotCalls(), 3)
})

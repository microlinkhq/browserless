'use strict'

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

const createGoto = ({ timeout = 1000 } = {}) => {
  let waitUntilAutoCalls = 0

  const goto = async (_page, { waitUntilAuto } = {}) => {
    if (waitUntilAuto) await waitUntilAuto(_page, { response: { headers: () => ({}) } })
    return { response: { headers: () => ({}) } }
  }

  goto.run = async ({ fn }) => ({ isRejected: false, value: await fn })
  goto.timeouts = { action: () => timeout }
  goto.waitUntilAuto = async () => {
    waitUntilAutoCalls += 1
  }
  goto.getWaitUntilAutoCalls = () => waitUntilAutoCalls

  return goto
}

const createPage = screenshots => {
  let screenshotCalls = 0

  return {
    on: () => {},
    off: () => {},
    evaluate: async () => undefined,
    $$eval: async () => undefined,
    screenshot: async () => screenshots[screenshotCalls++]
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

test('stops white screenshot retries after max attempts', async t => {
  const isWhiteScreenshotMock = async () => true
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto({ timeout: 10000 })
  const screenshots = Array.from({ length: 10 }, (_, index) => Buffer.from(`shot${index}`))
  const page = createPage(screenshots)
  const screenshot = createScreenshot({ goto })(page)

  const result = await screenshot('https://example.com', { waitUntil: 'auto', codeScheme: false })

  t.deepEqual(result, screenshots[createScreenshot.MAX_WHITE_RETRIES])
  t.is(goto.getWaitUntilAutoCalls(), createScreenshot.MAX_WHITE_RETRIES)
})

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

const createPage = (screenshots, { pageMetas = [] } = {}) => {
  let screenshotCalls = 0
  let pageMetaCall = 0

  return {
    on: () => {},
    off: () => {},
    evaluate: async expression => {
      if (expression === 'document.fonts.ready') return undefined
      if (typeof expression === 'function') {
        const source = expression.toString()
        const isPageMetaEval =
          source.includes('document.title') &&
          source.includes('document.body') &&
          source.includes('window.location.href')

        if (!isPageMetaEval) return undefined

        return (
          pageMetas[pageMetaCall++] || {
            title: '',
            bodyText: '',
            url: 'https://example.com'
          }
        )
      }
      return undefined
    },
    $$eval: async () => undefined,
    isClosed: () => false,
    screenshot: async () => screenshots[screenshotCalls++],
    getScreenshotCalls: () => screenshotCalls
  }
}

test('retries capture when navigation destroys the execution context', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto()
  const page = createPage([])

  // first capture races with a client-side navigation, second succeeds
  let calls = 0
  page.screenshot = async () => {
    if (calls++ === 0) {
      throw new Error('Execution context was destroyed, most likely because of a navigation.')
    }
    return Buffer.from('shot-ok')
  }

  const screenshot = createScreenshot({ goto })(page)
  const result = await screenshot('https://example.com', { waitUntil: 'auto', codeScheme: false })

  t.deepEqual(result, Buffer.from('shot-ok'))
  t.is(calls, 2)
  t.is(goto.getWaitUntilAutoCalls(), 1)
})

test('does not retry capture on a non-navigation error', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto()
  const page = createPage([])
  page.screenshot = async () => {
    throw new Error('boom')
  }

  const screenshot = createScreenshot({ goto })(page)
  await t.throwsAsync(screenshot('https://example.com', { waitUntil: 'auto', codeScheme: false }), {
    message: 'boom'
  })
  t.is(goto.getWaitUntilAutoCalls(), 0)
})

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

test('hydrates fullPage while the viewport is still white', async t => {
  const prepareModulePath = require.resolve('../src/prepare-full-document.js')
  const originalPrepareModule = require.cache[prepareModulePath]
  let hydrateCalls = 0

  require.cache[prepareModulePath] = {
    id: prepareModulePath,
    filename: prepareModulePath,
    loaded: true,
    exports: {
      ...require('../src/prepare-full-document'),
      tryHydrateScroll: async () => {
        hydrateCalls += 1
        return { hydrated: true, info: { hydrated: true } }
      }
    }
  }

  let whiteCalls = 0
  const isWhiteScreenshotMock = async () => ++whiteCalls === 1
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(() => {
    restore()
    delete require.cache[prepareModulePath]
    if (originalPrepareModule) {
      require.cache[prepareModulePath] = originalPrepareModule
    }
  })

  const goto = createGoto({ timeout: 5000 })
  const white = Buffer.from('white')
  const ready = Buffer.from('ready')
  const page = createPage([white, ready, ready])
  const screenshot = createScreenshot({ goto })(page)

  const result = await screenshot('https://example.com', {
    waitUntil: 'auto',
    fullPage: true,
    codeScheme: false
  })

  t.deepEqual(result, ready)
  t.is(hydrateCalls, 1)
})

test('waits for verification interstitial to resolve before screenshot', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto({ timeout: 10000 })
  const screenshots = [Buffer.from('shot1'), Buffer.from('shot2'), Buffer.from('shot3')]
  const page = createPage(screenshots, {
    pageMetas: [
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

// #852's fullPage readiness probe clears `path` so it does not write during the
// white check. #858 keeps `quality` when that path looked lossy. Together the
// probe becomes `{ quality }` with puppeteer's png default and throws.
test('fullPage readiness probe drops path-inferred quality', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto()
  const page = createPage([Buffer.from('probe'), Buffer.from('full')])
  const seen = []
  page.screenshot = async opts => {
    seen.push(opts)
    return Buffer.from(`shot-${seen.length}`)
  }

  const screenshot = createScreenshot({ goto })(page)
  const result = await screenshot('https://example.com', {
    waitUntil: 'auto',
    codeScheme: false,
    fullPage: true,
    path: '/tmp/out.jpg',
    quality: 80
  })

  t.true(Buffer.isBuffer(result))
  t.is(seen.length, 2)
  t.is(seen[0].fullPage, false)
  t.is(seen[0].path, undefined)
  t.is(seen[0].quality, undefined)
  t.is(seen[1].fullPage, true)
  t.is(seen[1].path, '/tmp/out.jpg')
  t.is(seen[1].quality, 80)
})

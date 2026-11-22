'use strict'

const { setTimeout: delay } = require('node:timers/promises')
const { default: test } = require('ava')

const { stubSettle, SETTLED } = require('./helpers/settled-stub')

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

const createGoto = ({ timeout = 1000, waitUntilAutoDelay = 0, loadTimeout } = {}) => {
  let waitUntilAutoCalls = 0
  const waitUntilAutoOpts = []

  const goto = async (_page, { waitUntilAuto } = {}) => {
    if (waitUntilAuto) {
      await waitUntilAuto(_page, { response: { headers: () => ({}) }, timeout: loadTimeout })
    }
    return { response: { headers: () => ({}) } }
  }

  goto.run = async ({ fn, timeout }) => {
    let timer
    const expired = new Promise((resolve, reject) => {
      if (timeout) timer = setTimeout(() => reject(new Error('Promise timed out')), timeout)
    })
    return Promise.race([fn, expired])
      .then(
        value => ({ isRejected: false, value }),
        reason => ({ isRejected: true, reason })
      )
      .finally(() => clearTimeout(timer))
  }
  goto.timeouts = { action: () => timeout, goto: () => timeout }
  goto.waitUntilAuto = async (_page, opts = {}) => {
    waitUntilAutoCalls += 1
    waitUntilAutoOpts.push(opts)
    if (waitUntilAutoDelay) await delay(waitUntilAutoDelay)
  }
  goto.getWaitUntilAutoCalls = () => waitUntilAutoCalls
  goto.getWaitUntilAutoOpts = () => waitUntilAutoOpts

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
  t.true(goto.getWaitUntilAutoOpts().every(opts => opts.credit === false))
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
  t.true(goto.getWaitUntilAutoOpts().every(opts => opts.credit === false))
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
  t.true(goto.getWaitUntilAutoOpts().every(opts => opts.timeout > 0))
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
  t.true(goto.getWaitUntilAutoOpts().every(opts => opts.credit === false))
})

test('a fullPage readiness probe is a cheap viewport capture, the output keeps its options', async t => {
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

  t.deepEqual(result, Buffer.from('shot-2'))
  t.is(seen.length, 2)
  t.deepEqual(seen[0], { optimizeForSpeed: true, type: 'jpeg', quality: 30 })
  t.is(seen[1].fullPage, true)
  t.is(seen[1].path, '/tmp/out.jpg')
  t.is(seen[1].quality, 80)
})

test('a fullPage probe keeps a transparent background, which a jpeg cannot hold', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto()
  const page = createPage([])
  const seen = []
  page.screenshot = async opts => {
    seen.push(opts)
    return Buffer.from(`shot-${seen.length}`)
  }

  await createScreenshot({ goto })(page)('https://example.com', {
    waitUntil: 'auto',
    codeScheme: false,
    fullPage: true,
    omitBackground: true,
    path: '/tmp/out.png'
  })

  t.deepEqual(seen[0], { omitBackground: true, fullPage: false })
  t.is(seen[1].fullPage, true)
  t.is(seen[1].omitBackground, true)
})

test('a transparent fullPage probe keeps the capture options a jpeg would drop', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const clip = { x: 1, y: 2, width: 3, height: 4, scale: 2 }
  const kept = {
    captureBeyondViewport: false,
    clip,
    fromSurface: false,
    optimizeForSpeed: false
  }

  for (const type of ['png', 'webp']) {
    const seen = []
    const page = createPage([])
    page.screenshot = async opts => {
      seen.push(opts)
      return Buffer.from(`shot-${seen.length}`)
    }

    await createScreenshot({ goto: createGoto() })(page)('https://example.com', {
      waitUntil: 'auto',
      codeScheme: false,
      fullPage: true,
      omitBackground: true,
      path: '/tmp/out.png',
      quality: 80,
      type,
      ...kept
    })

    t.deepEqual(seen[0], { omitBackground: true, fullPage: false, type, ...kept })
    t.is(seen[1].quality, type === 'png' ? undefined : 80)
    t.is(seen[1].path, '/tmp/out.png')
  }
})

test('a transparent fullPage probe drops a jpeg type, which cannot hold the background', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const seen = []
  const page = createPage([])
  page.screenshot = async opts => {
    seen.push(opts)
    return Buffer.from(`shot-${seen.length}`)
  }

  await createScreenshot({ goto: createGoto() })(page)('https://example.com', {
    waitUntil: 'auto',
    codeScheme: false,
    fullPage: true,
    omitBackground: true,
    path: '/tmp/out.jpg',
    quality: 80,
    type: 'jpeg'
  })

  t.deepEqual(seen[0], { omitBackground: true, fullPage: false })
  t.is(seen[1].type, 'jpeg')
  t.is(seen[1].omitBackground, true)
  t.is(seen[1].path, '/tmp/out.jpg')
  t.is(seen[1].quality, 80)
})

test('a viewport screenshot is the readiness probe and keeps its path and quality', async t => {
  const isWhiteScreenshotMock = async () => false
  const { createScreenshot, restore } = loadCreateScreenshot(isWhiteScreenshotMock)
  t.teardown(restore)

  const goto = createGoto()
  const page = createPage([])
  const seen = []
  page.screenshot = async opts => {
    seen.push(opts)
    return Buffer.from('shot')
  }

  const screenshot = createScreenshot({ goto })(page)
  const result = await screenshot('https://example.com', {
    waitUntil: 'auto',
    codeScheme: false,
    path: '/tmp/out.jpg',
    quality: 80
  })

  t.deepEqual(result, Buffer.from('shot'))
  t.is(seen.length, 1)
  t.is(seen[0].path, '/tmp/out.jpg')
  t.is(seen[0].quality, 80)
})

const withSettle = async (wait, fn) => {
  const original = stubSettle.wait
  stubSettle.wait = wait
  try {
    return await fn()
  } finally {
    stubSettle.wait = original
  }
}

test.serial(
  'settle that spends the whole budget still leaves the probe a full step budget',
  async t => {
    const responses = [true, true, false]
    const { createScreenshot, restore } = loadCreateScreenshot(
      async () => responses.shift() ?? false
    )
    t.teardown(restore)

    const goto = createGoto({ timeout: 300 })
    const screenshots = [Buffer.from('shot1'), Buffer.from('shot2'), Buffer.from('shot3')]
    const page = createPage(screenshots)

    const result = await withSettle(
      async ({ timeout }) => {
        await delay(timeout)
        return { ...SETTLED, settled: false, waited: timeout }
      },
      () =>
        createScreenshot({ goto })(page)('https://example.com', {
          waitUntil: 'auto',
          codeScheme: false
        })
    )

    t.deepEqual(result, screenshots[2])
  }
)

test('codeScheme reads the navigation response', async t => {
  const { createScreenshot, restore } = loadCreateScreenshot(async () => false)
  t.teardown(restore)

  const html = '<!DOCTYPE html><html><body>hi</body></html>'
  const run = async ({ waitUntil, codeScheme, response }) => {
    let textReads = 0
    let failures = 0
    const body =
      response === undefined
        ? undefined
        : {
            headers: () => ({ 'content-type': 'text/html' }),
            text: async () => {
              textReads += 1
              return html
            }
          }
    const goto = createGoto()
    const innerRun = goto.run
    goto.run = async opts => {
      const result = await innerRun(opts)
      if (result.isRejected) failures += 1
      return result
    }
    const call = goto
    const wrapped = async (page, opts) => {
      if (opts.waitUntilAuto) {
        const hook = opts.waitUntilAuto
        opts = {
          ...opts,
          waitUntilAuto: (page, hookOpts) => hook(page, { ...hookOpts, response: body })
        }
      }
      const result = await call(page, opts)
      return { ...result, response: body }
    }
    Object.assign(wrapped, goto)
    await createScreenshot({ goto: wrapped })(createPage([Buffer.from('shot')]))(
      'https://example.com',
      { waitUntil, codeScheme }
    )
    return { textReads, failures }
  }

  const highlighted = await run({
    waitUntil: 'auto',
    codeScheme: 'ghcolors',
    response: true
  })
  t.is(highlighted.textReads, 1)
  t.is(highlighted.failures, 0)

  const plain = await run({ waitUntil: 'auto', codeScheme: false, response: true })
  t.is(plain.textReads, 0)
  t.is(plain.failures, 0)

  const loaded = await run({ waitUntil: 'load', codeScheme: 'ghcolors', response: true })
  t.is(loaded.textReads, 1)
  t.is(loaded.failures, 0)

  const withoutResponse = await run({
    waitUntil: 'auto',
    codeScheme: 'ghcolors',
    response: undefined
  })
  t.is(withoutResponse.textReads, 0)
  t.is(withoutResponse.failures, 0)
})

test.serial(
  'screenshot readiness is budgeted by the step timeout, not the load timeout',
  async t => {
    const { createScreenshot, restore } = loadCreateScreenshot(async () => false)
    t.teardown(restore)

    const settleTimeouts = []
    const goto = createGoto({ timeout: 300, loadTimeout: 20000 })
    await withSettle(
      async ({ timeout }) => {
        settleTimeouts.push(timeout)
        return SETTLED
      },
      () =>
        createScreenshot({ goto })(createPage([Buffer.from('shot')]))('https://example.com', {
          waitUntil: 'auto',
          codeScheme: false
        })
    )

    t.deepEqual(settleTimeouts, [300])
  }
)

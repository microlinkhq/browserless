'use strict'

const { getBrowser } = require('@browserless/test')
const { spawnSync } = require('child_process')
const path = require('path')
const test = require('ava')

const browserlessFunction = require('..')

const browserless = getBrowser()

const opts = {
  getBrowserless: () => browserless,
  timeout: 120000
}

const fileUrl = `file://${path.join(__dirname, './fixtures/example.html')}`

test('code runs in strict mode', async t => {
  const code = () => {
    function isStrict () {
      return !this
    }
    return isStrict()
  }

  const myFn = browserlessFunction(code, opts)

  const { profiling, logging, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    value: false,
    isFulfilled: true
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('interact with page', async t => {
  const code = ({ page }) => page.title()

  const myFn = browserlessFunction(code, opts)
  const { profiling, logging, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    value: 'Example Domain',
    isFulfilled: true
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('handle errors', async t => {
  const code = () => {
    throw new Error('oh no')
  }

  const myFn = browserlessFunction(code, opts)
  const result = await myFn(fileUrl)

  t.false(result.isFulfilled)
  t.is(result.value.message, 'oh no')
  t.true(!!result.profiling)
  t.true(!!result.logging)
})

test('provide a mechanism to pass things to the function ', async t => {
  const code = ({ query }) => query.foo
  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl, { query: { foo: 'bar' } })

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'bar'
  })
  t.true(!!profiling)
  t.true(!!logging)
})

test('collect logs ', async t => {
  const code = ({ query }) => {
    console.log(query)
    return query.foo
  }

  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl, { query: { foo: 'bar' } })

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'bar'
  })

  t.deepEqual(logging, {
    log: [
      [
        {
          foo: 'bar'
        }
      ]
    ]
  })

  t.true(!!profiling)
})

test('access to device', async t => {
  const code = ({ device }) => device
  const myFn = browserlessFunction(code, opts)

  const { profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_12_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/62.0.3202.89 Safari/537.36',
      viewport: {
        width: 1280,
        height: 800,
        deviceScaleFactor: 2,
        isMobile: false,
        hasTouch: false,
        isLandscape: false
      }
    },
    logging: {}
  })

  t.true(!!profiling)
})

test('access to page', async t => {
  const code = ({ page }) => page.title()
  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'Example Domain'
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('access to page (with inline code)', async t => {
  const code = '({ page }) => page.title()'
  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'Example Domain'
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('access to page (with semicolon)', async t => {
  const code = '({ page }) => page.title();'
  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'Example Domain'
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('access to page (with semicolon and break lines)', async t => {
  const code = `({ page }) => {
    return page.title()
    ; }`
  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'Example Domain'
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('access to page (with semicolon and end break lines)', async t => {
  const code = '({ page }) => page.title();\n\n'
  const myFn = browserlessFunction(code, opts)

  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'Example Domain'
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('interact with a page', async t => {
  const code = async ({ page }) => {
    const navigationPromise = page.waitForNavigation()
    const link = 'body > div > p > a'
    await Promise.all([page.waitForSelector(link).then(() => page.click(link)), navigationPromise])
    const title = await page.title()
    return title
  }

  const myFn = browserlessFunction(code, opts)
  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: 'Example Domains'
  })

  t.true(!!profiling)
  t.true(!!logging)
})

test('pass goto options', async t => {
  const code = ({ page }) => page.evaluate('jQuery.fn.jquery')

  const fn = browserlessFunction(code, {
    ...opts,
    gotoOpts: {
      scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
    }
  })

  const { logging, profiling, ...result } = await fn(fileUrl)

  t.true(result.isFulfilled)
  t.is(result.value, '3.5.0')
  t.true(!!profiling)
  t.true(!!logging)
})

test('interact with npm modules', async t => {
  const code = async ({ page }) =>
    require('lodash').toString(await page.evaluate('jQuery.fn.jquery'))

  const fn = browserlessFunction(code, {
    ...opts,
    gotoOpts: {
      scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
    }
  })

  const { logging, profiling, ...result } = await fn(fileUrl)

  t.true(result.isFulfilled)
  t.is(result.value, '3.5.0')
  t.true(!!profiling)
  t.true(!!logging)
})

test('throws error when browser is launched with pipe mode', async t => {
  const createTestUtil = require('@browserless/test/create')
  const { getBrowser } = createTestUtil({ pipe: true })

  const code = ({ page }) => page.title()

  const myFn = browserlessFunction(code, {
    getBrowserless: () => getBrowser()
  })

  const error = await t.throwsAsync(myFn(fileUrl))
  t.is(error.message, 'Browser WebSocket endpoint not found')
})

test('retrieve browser websocket endpoint once per invocation', async t => {
  let browserCalls = 0

  const fakeBrowserless = {
    withPage: fn => async () =>
      fn({}, async () => ({ device: { viewport: {}, userAgent: 'ua' } }))(),
    browser: async () => {
      browserCalls += 1
      return { wsEndpoint: () => 'ws://example' }
    }
  }

  const fn = browserlessFunction(() => 'ok', {
    getBrowserless: async () => ({
      createContext: async () => fakeBrowserless
    })
  })

  const result = await fn('https://example.com')

  t.true(result.isFulfilled)
  t.is(result.value, 'ok')
  t.is(browserCalls, 1)
})

test('reuse function code analysis across invocations', t => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    let parseCalls = 0

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        return () => [async () => ({ isFulfilled: true, value: 'ok' }), async () => {}]
      }

      if (request === 'acorn') {
        const acorn = originalLoad(request, parent, isMain)
        return {
          ...acorn,
          parse (...args) {
            parseCalls += 1
            return acorn.parse(...args)
          }
        }
      }
      return originalLoad(request, parent, isMain)
    }

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})

    const fakeBrowserless = {
      withPage: fn => async () =>
        fn({}, async () => ({ device: { viewport: {}, userAgent: 'ua' } }))(),
      browser: async () => ({ wsEndpoint: () => 'ws://example' })
    }

    const fn = browserlessFunction(() => 'ok', {
      getBrowserless: async () => ({
        createContext: async () => fakeBrowserless
      })
    })

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(() => fn('https://example.com'))
      .then(() => process.stdout.write(String(parseCalls)))
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.is(stdout.trim(), '1')
})

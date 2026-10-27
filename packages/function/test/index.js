'use strict'

const { getBrowser } = require('@browserless/test')
const { spawnSync } = require('child_process')
const path = require('path')
const { default: test } = require('ava')

const browserlessFunction = require('..')()

const browserless = getBrowser()

const opts = {
  getBrowserless: () => browserless,
  timeout: 120000
}

const fileUrl = `file://${path.join(__dirname, './fixtures/example.html')}`

// Fills the slot the way isolated-function does: user code is compiled with
// `new Function` at global scope, with the CommonJS bindings passed in.
const isolatedFunctionMock = `
        const SLOT = '__ISOLATED_FUNCTION_SLOT__'
        const SCOPE = ['exports', 'require', 'module', '__filename', '__dirname']
        const create = ({ tmpdir } = {}) => {
          const instance = (source, { slot } = {}) => {
            const filled =
              slot === undefined
                ? source
                : source.replace(SLOT, () => {
                    const body = JSON.stringify('return (' + slot + '\\n)')
                    return (
                      '(new Function(' +
                      SCOPE.map(name => "'" + name + "'").join(', ') +
                      ', ' +
                      body +
                      ').call(exports, ' +
                      SCOPE.join(', ') +
                      '))'
                    )
                  })
            const fn = new Function(...SCOPE, 'return (' + filled + ')')(
              exports,
              require,
              module,
              __filename,
              __dirname
            )
            return async (...args) => {
              try {
                return { isFulfilled: true, value: await fn(...args) }
              } catch (error) {
                return { isFulfilled: false, value: { message: error.message } }
              }
            }
          }
          instance.teardown = async () => {}
          return instance
        }
        create.SLOT = SLOT
        return create`

const runPageFnSubprocess = body => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        return () => {
          const instance = () => async () => ({ isFulfilled: true, value: 'ok' })
          instance.teardown = async () => {}
          return instance
        }
      }
      return originalLoad(request, parent, isMain)
    }

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})()
    ${body}
  `

  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' })
}

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

test('`args` reach the function without touching runtime options', async t => {
  const code = ({ code, source, needsNetwork, vmOpts }) => ({ code, source, needsNetwork, vmOpts })
  const args = { code: 'abc', source: 'not a program', needsNetwork: true, vmOpts: 1 }
  const myFn = browserlessFunction(code, { ...opts, args })

  const { logging, profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, { isFulfilled: true, value: args })
})

test('a numeric `code` in `args` is an argument, not the snippet', async t => {
  const myFn = browserlessFunction(({ code }) => code, opts)
  const { logging, profiling, ...result } = await myFn(fileUrl, { args: { code: 7 } })
  t.deepEqual(result, { isFulfilled: true, value: 7 })
})

test('per-call `args` merge over the ones the function was created with', async t => {
  const code = ({ a, b }) => ({ a, b })
  const myFn = browserlessFunction(code, { ...opts, args: { a: 1, b: 1 } })
  const { logging, profiling, ...result } = await myFn(fileUrl, { args: { b: 2 } })
  t.deepEqual(result, { isFulfilled: true, value: { a: 1, b: 2 } })
})

test('`args` reach a function that uses the page', async t => {
  const code = async ({ page, code }) => ({ title: await page.title(), code })
  const myFn = browserlessFunction(code, { ...opts, args: { code: 'abc' } })
  const { logging, profiling, ...result } = await myFn(fileUrl)
  t.true(result.isFulfilled)
  t.is(result.value.code, 'abc')
  t.is(typeof result.value.title, 'string')
})

test('`args` cannot replace the page or move the function to another target', async t => {
  const code = async ({ page }) => page.title()
  const myFn = browserlessFunction(code, {
    ...opts,
    args: { page: 2, targetId: 'bogus', strictTarget: true, browserWSEndpoint: 'ws://127.0.0.1:1' }
  })
  const { logging, profiling, ...result } = await myFn(fileUrl)
  t.true(result.isFulfilled)
  t.is(typeof result.value, 'string')
})

test('a bad per-call `args` rejects before the browser is asked for', async t => {
  let asked = 0
  const myFn = browserlessFunction(({ page }) => page.title(), {
    ...opts,
    getBrowserless: () => {
      asked++
      return browserless
    }
  })
  await t.throwsAsync(() => myFn(fileUrl, { args: 'abc' }), { instanceOf: TypeError })
  t.is(asked, 0)
})

test('a `null` per-call `args` rejects', async t => {
  const myFn = browserlessFunction(() => 1, opts)
  await t.throwsAsync(() => myFn(fileUrl, { args: null }), {
    instanceOf: TypeError,
    message: 'Expected `args` to be a plain object'
  })
})

test('`args` must be a plain object', t => {
  t.throws(() => browserlessFunction(() => 1, { ...opts, args: 'abc' }), {
    instanceOf: TypeError,
    message: 'Expected `args` to be a plain object'
  })
})

test('`args` stay nested on every path, and null options keep creation `args`', t => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    const seen = []

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        return () => {
          const instance = () => async (url, endpoint, opts) => {
            const record = {
              endpoint: endpoint ?? null,
              args: Object.hasOwn(opts, 'args') ? opts.args : null,
              targetId: opts.targetId ?? null,
              strictTarget: opts.strictTarget === true
            }
            seen.push(record)
            return { isFulfilled: true, value: 'ok' }
          }
          instance.teardown = async () => {}
          return instance
        }
      }
      return originalLoad(request, parent, isMain)
    }

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})()
    const ask = () => {
      throw new Error('browser')
    }
    const myFn = browserlessFunction(({ code }) => code, {
      getBrowserless: ask,
      args: { code: 1 }
    })
    const bare = browserlessFunction(({ code }) => code, { getBrowserless: ask })
    const nullProto = Object.create(null)
    nullProto.code = 7
    const page = {
      browser: () => ({ wsEndpoint: () => 'ws://example' }),
      createCDPSession: async () => ({
        send: async () => ({ targetInfo: { targetId: 'real' } }),
        detach: async () => {}
      })
    }
    const pageFn = browserlessFunction(async ({ page: current }) => current, {
      getBrowserless: async () => ({
        createContext: async () => ({
          withPage: handler => async () =>
            handler(page, async () => ({ device: { userAgent: 'ua', viewport: { width: 1 } } }))(),
          destroyContext: async () => {}
        })
      })
    })
    const handed = browserlessFunction(async ({ page: current }) => current, {
      getBrowserless: ask,
      getPage: async () => ({ page })
    })
    const nested = { code: 3, targetId: 'bogus', browserWSEndpoint: 'ws://evil' }

    Promise.resolve()
      .then(() => myFn('https://example.com'))
      .then(() => myFn('https://example.com', null))
      .then(() => myFn('https://example.com', { args: { code: 2 } }))
      .then(() => bare('https://example.com'))
      .then(() => bare('https://example.com', null))
      .then(() => bare('https://example.com', { args: nullProto }))
      .then(() => bare('https://example.com', { args: {} }))
      .then(() => pageFn('https://example.com', { args: nested }))
      .then(() => handed('https://example.com', { args: nested }))
      .then(() => process.stdout.write(JSON.stringify(seen)))
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.deepEqual(JSON.parse(stdout), [
    { endpoint: null, args: { code: 1 }, targetId: null, strictTarget: false },
    { endpoint: null, args: { code: 1 }, targetId: null, strictTarget: false },
    { endpoint: null, args: { code: 2 }, targetId: null, strictTarget: false },
    { endpoint: null, args: null, targetId: null, strictTarget: false },
    { endpoint: null, args: null, targetId: null, strictTarget: false },
    { endpoint: null, args: { code: 7 }, targetId: null, strictTarget: false },
    { endpoint: null, args: {}, targetId: null, strictTarget: false },
    {
      endpoint: 'ws://example',
      args: { code: 3, targetId: 'bogus', browserWSEndpoint: 'ws://evil' },
      targetId: 'real',
      strictTarget: false
    },
    {
      endpoint: 'ws://example',
      args: { code: 3, targetId: 'bogus', browserWSEndpoint: 'ws://evil' },
      targetId: 'real',
      strictTarget: true
    }
  ])
})

test('a per-call `args` that is not a plain object rejects', async t => {
  const myFn = browserlessFunction(() => 1, opts)
  await t.throwsAsync(() => myFn(fileUrl, { args: [1] }), {
    instanceOf: TypeError,
    message: 'Expected `args` to be a plain object'
  })
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

test('functions with the same shape share one built program', async t => {
  // A fresh instance, so no other test has warmed its shell cache. No
  // teardown: it deletes the shared tmpdir other tests install into.
  const createFunction = require('..')()

  const first = await createFunction(({ query }) => query.n * 2, opts)(fileUrl, {
    query: { n: 21 }
  })
  const second = await createFunction(({ query }) => query.n + 1, opts)(fileUrl, {
    query: { n: 21 }
  })

  t.is(first.value, 42)
  t.is(second.value, 22)
  t.is(createFunction.shells.size, 1, 'both functions should be served by one built program')
})

test('an extendPage method may mention the slot sentinel', async t => {
  const createFunction = require('..')()
  const result = await createFunction(({ page }) => page.marker(), {
    ...opts,
    extendPage: {
      marker () {
        return '__ISOLATED_FUNCTION_SLOT__'
      }
    }
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(result.value, '__ISOLATED_FUNCTION_SLOT__')
})

test('device is undefined for non-page functions', async t => {
  const code = ({ device }) => device === undefined
  const myFn = browserlessFunction(code, opts)

  const { profiling, ...result } = await myFn(fileUrl)

  t.deepEqual(result, {
    isFulfilled: true,
    value: true,
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

test('response is undefined for non-page functions', async t => {
  const code = ({ response }) => response === undefined
  const myFn = browserlessFunction(code, opts)
  const { profiling, logging, ...result } = await myFn('https://example.com')

  t.true(result.isFulfilled)
  t.is(result.value, true)
  t.true(!!profiling)
})

test('access to response (with page)', async t => {
  const code = async ({ page, response }) => ({
    title: await page.title(),
    status: response.status()
  })

  const myFn = browserlessFunction(code, opts)
  const { profiling, logging, ...result } = await myFn('https://example.com')

  t.true(result.isFulfilled)
  t.is(result.value.title, 'Example Domain')
  t.is(result.value.status, 200)
  t.true(!!profiling)
  t.true(!!logging)
})

test('response is serialized and reconstructed with callable methods (page function)', t => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        ${isolatedFunctionMock}
      }
      if (request === '@cloudflare/puppeteer') {
        return { connect: async () => ({
          pages: async () => [],
          disconnect: async () => {}
        }) }
      }
      return originalLoad(request, parent, isMain)
    }

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})()

    const fakeResponse = {
      status: () => 200,
      statusText: () => 'OK',
      url: () => 'https://example.com',
      ok: () => true,
      headers: () => ({ 'content-type': 'text/html' }),
      remoteAddress: () => ({ ip: '93.184.216.34', port: 443 }),
      timing: () => null,
      fromCache: () => false,
      fromServiceWorker: () => false
    }

    const fakeBrowserless = {
      withPage: fn => async () =>
        fn(
          { browser: () => ({ wsEndpoint: () => 'ws://example' }) },
          async () => ({
            device: { viewport: {}, userAgent: 'ua' },
            response: fakeResponse
          })
        )(),
      destroyContext: async () => {}
    }

    const fn = browserlessFunction(
      ({ page, response }) => ({
        status: response.status(),
        ok: response.ok(),
        url: response.url(),
        headers: response.headers()
      }),
      {
        getBrowserless: async () => ({
          createContext: async () => fakeBrowserless
        })
      }
    )

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(result => process.stdout.write(JSON.stringify(result)))
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  const result = JSON.parse(stdout.trim())
  t.true(result.isFulfilled)
  t.deepEqual(result.value, {
    status: 200,
    ok: true,
    url: 'https://example.com',
    headers: { 'content-type': 'text/html' }
  })
})

test('response is undefined for non-page functions (subprocess)', t => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        ${isolatedFunctionMock}
      }
      return originalLoad(request, parent, isMain)
    }

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})()

    const fn = browserlessFunction(
      ({ response }) => response === undefined,
      { getBrowserless: async () => ({}) }
    )

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(result => process.stdout.write(JSON.stringify(result)))
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  const result = JSON.parse(stdout.trim())
  t.true(result.isFulfilled)
  t.is(result.value, true)
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

test('non-page functions skip browser entirely', async t => {
  let getBrowserlessCalls = 0

  const fn = browserlessFunction(() => 'ok', {
    getBrowserless: async () => {
      getBrowserlessCalls += 1
      return {}
    }
  })

  const result = await fn('https://example.com')

  t.true(result.isFulfilled)
  t.is(result.value, 'ok')
  t.is(getBrowserlessCalls, 0)
})

test('access to url without spinning a browser', async t => {
  let getBrowserlessCalls = 0

  const fn = browserlessFunction(({ url }) => url, {
    getBrowserless: async () => {
      getBrowserlessCalls += 1
      return {}
    }
  })

  const result = await fn('https://example.com')

  t.true(result.isFulfilled)
  t.is(result.value, 'https://example.com')
  t.is(getBrowserlessCalls, 0)
})

test('prefer page browser websocket endpoint when available', t => {
  const { status, stdout, stderr } = runPageFnSubprocess(`
    let browserCalls = 0
    const fakeBrowserless = {
      withPage: fn => async () =>
        fn(
          { browser: () => ({ wsEndpoint: () => 'ws://from-page' }) },
          async () => ({ device: { viewport: {}, userAgent: 'ua' } })
        )(),
      browser: async () => {
        browserCalls += 1
        return { wsEndpoint: () => 'ws://from-browserless' }
      },
      destroyContext: async () => {}
    }

    const fn = browserlessFunction(({ page }) => page.title(), {
      getBrowserless: async () => ({
        createContext: async () => fakeBrowserless
      })
    })

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(result => {
        process.stdout.write(JSON.stringify({ browserCalls, result }))
      })
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `)

  t.is(status, 0, stderr)
  const { browserCalls, result } = JSON.parse(stdout.trim())
  t.is(browserCalls, 0)
  t.true(result.isFulfilled)
  t.is(result.value, 'ok')
})

test('reuse function code analysis across invocations', t => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    let parseCalls = 0

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        return ({ tmpdir } = {}) => {
          const instance = () => async () => ({ isFulfilled: true, value: 'ok' })
          instance.teardown = async () => {}
          return instance
        }
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

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})()

    const fn = browserlessFunction(() => 'ok', {
      getBrowserless: async () => ({})
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

test('reuse compiled template source across invocations', t => {
  const browserlessFunctionPath = require.resolve('..')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    let templateCalls = 0
    let parseCalls = 0

    Module._load = function (request, parent, isMain) {
      if (request === 'isolated-function') {
        return ({ tmpdir } = {}) => {
          const instance = () => async () => ({ isFulfilled: true, value: 'ok' })
          instance.teardown = async () => {}
          return instance
        }
      }

      if (request === './template') {
        const template = originalLoad(request, parent, isMain)
        const wrapped = (...args) => {
          templateCalls += 1
          return template(...args)
        }
        Object.assign(wrapped, template)
        wrapped.isUsingPage = (...args) => {
          parseCalls += 1
          return template.isUsingPage(...args)
        }
        return wrapped
      }

      return originalLoad(request, parent, isMain)
    }

    const browserlessFunction = require(${JSON.stringify(browserlessFunctionPath)})()

    const fn = browserlessFunction(() => 'ok', {
      getBrowserless: async () => ({})
    })

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(() => fn('https://example.com'))
      .then(() => process.stdout.write(JSON.stringify({ templateCalls, parseCalls })))
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.deepEqual(JSON.parse(stdout.trim()), { templateCalls: 1, parseCalls: 1 })
})

test('reuse browserless instance across page function invocations', t => {
  const { status, stdout, stderr } = runPageFnSubprocess(`
    let getBrowserlessCalls = 0
    let createContextCalls = 0
    let destroyContextCalls = 0
    const fakeBrowserless = {
      withPage: fn => async () =>
        fn(
          { browser: () => ({ wsEndpoint: () => 'ws://example' }) },
          async () => ({ device: { viewport: {}, userAgent: 'ua' } })
        )(),
      destroyContext: async () => {
        destroyContextCalls += 1
      }
    }

    const fn = browserlessFunction(({ page }) => 'ok', {
      getBrowserless: async () => {
        getBrowserlessCalls += 1
        return {
          createContext: async () => {
            createContextCalls += 1
            return fakeBrowserless
          }
        }
      }
    })

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(() => fn('https://example.com'))
      .then(() =>
        process.stdout.write(
          JSON.stringify({ getBrowserlessCalls, createContextCalls, destroyContextCalls })
        )
      )
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `)

  t.is(status, 0, stderr)
  const { getBrowserlessCalls, createContextCalls, destroyContextCalls } = JSON.parse(stdout.trim())
  t.is(getBrowserlessCalls, 1)
  t.is(createContextCalls, 2)
  t.is(destroyContextCalls, 2)
})

test('destroys the browser context when withPage fails (subprocess)', t => {
  const { status, stdout, stderr } = runPageFnSubprocess(`
    let destroyContextCalls = 0
    const fakeBrowserless = {
      withPage: () => async () => {
        throw new Error('goto failed')
      },
      destroyContext: async () => {
        destroyContextCalls += 1
      }
    }

    const fn = browserlessFunction(({ page }) => 'ok', {
      getBrowserless: async () => ({
        createContext: async () => fakeBrowserless
      })
    })

    Promise.resolve()
      .then(() => fn('https://example.com'))
      .then(() => {
        process.stderr.write('expected rejection')
        process.exit(1)
      })
      .catch(error => {
        process.stdout.write(
          JSON.stringify({ message: error.message, destroyContextCalls })
        )
      })
  `)

  t.is(status, 0, stderr)
  const { message, destroyContextCalls } = JSON.parse(stdout.trim())
  t.is(message, 'goto failed')
  t.is(destroyContextCalls, 1)
})

test('retry getBrowserless on next call when initial creation fails', t => {
  const { status, stdout, stderr } = runPageFnSubprocess(`
    let getBrowserlessCalls = 0
    const fakeBrowserless = {
      withPage: fn => async () =>
        fn(
          { browser: () => ({ wsEndpoint: () => 'ws://example' }) },
          async () => ({ device: { viewport: {}, userAgent: 'ua' } })
        )(),
      destroyContext: async () => {}
    }

    const fn = browserlessFunction(({ page }) => 'ok', {
      getBrowserless: async () => {
        getBrowserlessCalls += 1
        if (getBrowserlessCalls === 1) {
          throw new Error('temporary failure')
        }
        return {
          createContext: async () => fakeBrowserless
        }
      }
    })

    Promise.resolve()
      .then(() => fn('https://example.com').then(() => 'no-error').catch(e => e.message))
      .then(firstResult => {
        return fn('https://example.com').then(second => {
          process.stdout.write(
            JSON.stringify({
              firstResult,
              secondFulfilled: second.isFulfilled,
              getBrowserlessCalls
            })
          )
        })
      })
      .catch(error => {
        process.stderr.write(String(error && error.stack ? error.stack : error))
        process.exit(1)
      })
  `)

  t.is(status, 0, stderr)
  const { firstResult, secondFulfilled, getBrowserlessCalls } = JSON.parse(stdout.trim())
  t.is(firstResult, 'temporary failure')
  t.true(secondFulfilled)
  t.is(getBrowserlessCalls, 2)
})

test('concurrent page functions return the correct page for each request', async t => {
  const { runServer } = require('@browserless/test/create')({ timeout: 120000 })

  const CONCURRENCY = 5

  const urls = await Promise.all(
    Array.from({ length: CONCURRENCY }, (_, i) =>
      runServer(t, ({ res }) => {
        res.setHeader('content-type', 'text/html')
        res.end(`<html><head><title>page-${i}</title></head><body>page-${i}</body></html>`)
      })
    )
  )

  const fns = urls.map(url => browserlessFunction(({ page }) => page.url(), opts))

  const results = await Promise.all(fns.map((fn, i) => fn(urls[i])))

  for (let i = 0; i < CONCURRENCY; i++) {
    t.true(results[i].isFulfilled, `request ${i} should succeed`)
    t.is(results[i].value, urls[i], `request ${i} should return its own URL`)
  }
})

test('isHttpResponse rejects non-response values', t => {
  const { isHttpResponse } = require('..')

  // a real puppeteer HTTPResponse exposes `status` as a method
  t.true(isHttpResponse({ status: () => 200 }))

  // goto can yield no navigation response (timeout / same-document nav)
  t.false(isHttpResponse(null))
  t.false(isHttpResponse(undefined))

  // a `p-reflect` settlement object must NOT be treated as a response:
  // it is truthy but `status` is not callable, which used to crash
  // serializeResponse with "response.status is not a function"
  t.false(isHttpResponse({ isFulfilled: true, isRejected: false, value: undefined }))
})

test('a dependency already present is not installed again', async t => {
  // `lodash` is a devDependency of this package, so it is on disk before the
  // snippet runs. Resolving `nodePaths` by walking up from `@cloudflare/puppeteer`
  // only found it under a flat install; with pnpm it landed in the isolated store
  // and every snippet paid a fresh install of something already there.
  const code = async () => require('lodash').VERSION

  const { profiling } = await browserlessFunction(code, opts)(fileUrl)

  t.is(profiling.phases.install, 0)
})

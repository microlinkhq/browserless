'use strict'

const { getBrowser } = require('@browserless/test/util')
const path = require('path')
const test = require('ava')

const browserlessFunction = require('..')

const browserlessFactory = getBrowser()

const opts = {
  getBrowserless: () => browserlessFactory,
  timeout: 120000,
  vmOpts: {
    require: {
      external: {
        builtin: ['path', 'url'],
        modules: [
          'p-reflect',
          'p-retry',
          'browserless',
          'metascraper',
          'metascraper-',
          '@metascraper',
          'lodash'
        ]
      }
    }
  }
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

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: true
  })
})

test("don't expose process.env", async t => {
  const code = () => JSON.stringify(process.env)

  const myFn = browserlessFunction(code, opts)

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: '{}'
  })
})

test('handle errors', async t => {
  const code = () => {
    throw new Error('oh no')
  }

  const myFn = browserlessFunction(code, opts)
  const result = await myFn(fileUrl)

  t.true(result.isRejected)
  t.is(result.reason.message, 'oh no')
})

test('provide a mechanism to pass things to the function ', async t => {
  const code = ({ query }) => query.foo
  const myFn = browserlessFunction(code, opts)

  t.deepEqual(await myFn(fileUrl, { query: { foo: 'bar' } }), {
    isFulfilled: true,
    isRejected: false,
    value: 'bar'
  })
})

test('access to response', async t => {
  const code = ({ response }) => response.status()
  const myFn = browserlessFunction(code, opts)

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: 200
  })
})

test('access to page', async t => {
  const code = ({ page }) => page.title()
  const myFn = browserlessFunction(code, opts)

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('access to page (with inline code)', async t => {
  const myFn = browserlessFunction('({ page }) => page.title()', opts)

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('access to page (with semicolon)', async t => {
  const myFn = browserlessFunction('({ page }) => page.title();', opts)

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('access to page (with semicolon and break lines)', async t => {
  const myFn = browserlessFunction(
    `({ page }) => {
    return page.title()
    ; }`,
    opts
  )

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('access to page (with semicolon and end break lines)', async t => {
  const myFn = browserlessFunction('({ page }) => page.title();\n\n', opts)

  t.deepEqual(await myFn(fileUrl), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('interact with a page', async t => {
  const code = async ({ page }) => {
    const navigationPromise = page.waitForNavigation()
    const link = 'body > div > p > a'
    await Promise.all([page.waitForSelector(link).then(() => page.click(link)), navigationPromise])
    const title = await page.title()
    return title
  }

  const fn = browserlessFunction(code, opts)
  const { isFulfilled, isRejected, value } = await fn(fileUrl)

  t.true(isFulfilled)
  t.false(isRejected)
  t.true(value.startsWith('Example Domains'))
})

test('pass goto options', async t => {
  const code = ({ page }) => page.evaluate('jQuery.fn.jquery')

  const fn = browserlessFunction(code, opts)
  const { isFulfilled, isRejected, value } = await fn(fileUrl, {
    gotoOpts: {
      scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
    }
  })

  t.true(isFulfilled)
  t.false(isRejected)
  t.is(value, '3.5.0')
})

test('interact with npm modules', async t => {
  const code = async ({ page }) =>
    require('lodash').toString(await page.evaluate('jQuery.fn.jquery'))

  const fn = browserlessFunction(code, opts)
  const { isFulfilled, isRejected, value } = await fn(fileUrl, {
    gotoOpts: {
      scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
    }
  })

  t.true(isFulfilled)
  t.false(isRejected)
  t.is(value, '3.5.0')
})

'use strict'

const test = require('ava')

const browserlessFunction = require('..')

const vmOpts = {
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

test('handle errors', async t => {
  const code = () => {
    throw new Error('oh no')
  }

  const myFn = browserlessFunction(code, { vmOpts })
  const result = await myFn('https://example.com')

  t.true(result.isRejected)
  t.is(result.reason.message, 'oh no')
})

test('provide a mechanism to pass things to the function ', async t => {
  const code = ({ query }) => query.foo
  const myFn = browserlessFunction(code, { vmOpts })

  t.deepEqual(await myFn('https://example.com', { query: { foo: 'bar' } }), {
    isFulfilled: true,
    isRejected: false,
    value: 'bar'
  })
})

test('access to response', async t => {
  const code = ({ response }) => response.status()
  const myFn = browserlessFunction(code, { vmOpts })

  t.deepEqual(await myFn('https://example.com'), {
    isFulfilled: true,
    isRejected: false,
    value: 200
  })
})

test('access to page', async t => {
  const code = ({ page }) => page.title()
  const myFn = browserlessFunction(code, { vmOpts })

  t.deepEqual(await myFn('https://example.com'), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('access to page (with inline code)', async t => {
  const myFn = browserlessFunction('({ page }) => page.title()', { vmOpts })

  t.deepEqual(await myFn('https://example.com'), {
    isFulfilled: true,
    isRejected: false,
    value: 'Example Domain'
  })
})

test('access to page (with semicolon)', async t => {
  const myFn = browserlessFunction('({ page }) => page.title();', { vmOpts })

  t.deepEqual(await myFn('https://example.com'), {
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
    { vmOpts }
  )

  t.deepEqual(await myFn('https://example.com'), {
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

  const fn = browserlessFunction(code, { vmOpts })
  const { isFulfilled, isRejected, value } = await fn('https://example.com')

  t.true(isFulfilled)
  t.false(isRejected)
  t.true(value.startsWith('IANA'))
})

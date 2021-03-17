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

test('access to query', async t => {
  const code = ({ query }) => query.foo
  const myFn = browserlessFunction(code, { vmOpts })

  t.deepEqual(await myFn('https://example.com', { foo: 'bar' }), {
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

test('interact with a page', async t => {
  const code = async ({ page }) => {
    await page.click('a[href="/blog"')
    await page.click('a[href="/speed-the-feature/"')
    return page.title()
  }

  const myFn = browserlessFunction(code, { vmOpts })

  t.deepEqual(await myFn('https://example.com'), {
    isFulfilled: true,
    isRejected: false,
    value: 'Speed is the feature | Kikobeats'
  })
})

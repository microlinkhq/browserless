'use strict'

const test = require('ava')

const browserlessFunction = require('..')()

const noBrowser = {
  timeout: 120000,
  getBrowserless: async () => {
    throw new Error('browser should not start')
  }
}

test('extendPage JSON getters skip the browser', async t => {
  const code = ({ page }) => page.ping()
  const myFn = browserlessFunction(code, {
    ...noBrowser,
    extendPage: { ping: 'pong' }
  })

  const { profiling, logging, ...result } = await myFn('https://example.com')

  t.deepEqual(result, { isFulfilled: true, value: 'pong' })
  t.true(!!profiling)
  t.true(!!logging)
})

test('needsBrowser true starts the browser even with only extendPage keys', async t => {
  const myFn = browserlessFunction('({ page }) => page.ping()', {
    needsBrowser: true,
    extendPage: { ping: 'pong' },
    getBrowserless: async () => {
      t.pass()
      throw new Error('stop')
    }
  })
  await t.throwsAsync(() => myFn('https://example.com'))
})

test('extendPage functions read stub page.content', async t => {
  const code = ({ page }) => page.echo()
  const myFn = browserlessFunction(code, {
    ...noBrowser,
    extendPage: {
      echo: async function echo () {
        return this.content()
      }
    }
  })

  const { profiling, logging, ...result } = await myFn('https://example.com', {
    _html: '<h1>stub</h1>'
  })

  t.deepEqual(result, { isFulfilled: true, value: '<h1>stub</h1>' })
  t.true(!!profiling)
  t.true(!!logging)
})

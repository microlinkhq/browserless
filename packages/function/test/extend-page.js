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

test('extendPage functions read stub page.html', async t => {
  const code = ({ page }) => page.echo()
  const myFn = browserlessFunction(code, {
    ...noBrowser,
    extendPage: {
      html: '<h1>stub</h1>',
      echo: async function echo () {
        return this.html()
      }
    }
  })

  const { profiling, logging, ...result } = await myFn('https://example.com')

  t.deepEqual(result, { isFulfilled: true, value: '<h1>stub</h1>' })
  t.true(!!profiling)
  t.true(!!logging)
})

test('extendPage url and html skip the browser', async t => {
  const code = async ({ page }) => ({
    url: await page.url(),
    html: await page.html()
  })
  const myFn = browserlessFunction(code, {
    ...noBrowser,
    extendPage: {
      url: 'https://example.com',
      html: '<h1>stub</h1>'
    }
  })

  const { profiling, logging, ...result } = await myFn('https://other.example')

  t.deepEqual(result, {
    isFulfilled: true,
    value: { url: 'https://example.com', html: '<h1>stub</h1>' }
  })
  t.true(!!profiling)
  t.true(!!logging)
})

test('extendPage stub still receives the target url', async t => {
  const code = async ({ page, url }) => ({
    url,
    html: await page.html()
  })
  const myFn = browserlessFunction(code, {
    ...noBrowser,
    extendPage: { html: '<h1>stub</h1>' }
  })

  const { profiling, logging, ...result } = await myFn('https://example.com')

  t.deepEqual(result, {
    isFulfilled: true,
    value: { url: 'https://example.com', html: '<h1>stub</h1>' }
  })
  t.true(!!profiling)
  t.true(!!logging)
})

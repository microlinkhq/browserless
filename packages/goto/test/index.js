'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const test = require('ava')

test('setup `scripts`', async t => {
  const browserless = await getBrowserContext(t)

  const getVersion = browserless.evaluate(async page => page.evaluate('jQuery.fn.jquery'))

  const version = await getVersion('https://github.com', {
    scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
  })

  t.is(version, '3.5.0')
})

test('setup `modules`', async t => {
  const browserless = await getBrowserContext(t)

  const getVersion = browserless.evaluate(async page => page.evaluate('jQuery.fn.jquery'))

  const version = await getVersion('https://github.com', {
    modules: ['https://code.jquery.com/jquery-3.5.0.min.js']
  })

  t.is(version, '3.5.0')
})

test('setup `styles`', async t => {
  const browserless = await getBrowserContext(t)

  const getStyle = browserless.evaluate(async page =>
    page.evaluate('window.getComputedStyle(document.body).fontFamily')
  )

  const style = await getStyle('https://github.com', {
    styles: ['https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css']
  })

  t.is(style, '"Helvetica Neue", Helvetica, Arial, sans-serif')
})

test('handle page disconnections', async t => {
  t.plan(1)
  const browserless = await getBrowserContext(t, { retry: 0 })
  const onPageRequest = req => {
    console.log('req.url', req.url)
  }
  const intercept = browserless.withPage((page, goto) => async url => {
    await page.close()

    const result = await goto(page, {
      url,
      onPageRequest,
      abortTypes: ['image', 'stylesheet', 'font']
    })

    t.deepEqual(Object.keys(result), ['response', 'device', 'error'])
  })

  await intercept('chrome://version')
})

test('handle page.goto hanging', async t => {
  const browserless = await getBrowserContext(t)

  const html = await browserless.html('https://test-timeout.vercel.app/', {
    timeout: 5000,
    animations: true
  })

  t.is(html, '<html><head></head><body></body></html>')
})

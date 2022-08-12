'use strict'

const { getBrowserless } = require('@browserless/test/util')
const test = require('ava')

const browserlessFactory = getBrowserless()

test('setup `scripts`', async t => {
  const browserless = await browserlessFactory.createContext()

  t.teardown(browserless.destroyContext)

  const getVersion = browserless.evaluate(async page => page.evaluate('jQuery.fn.jquery'))

  const version = await getVersion('https://github.com', {
    scripts: ['https://code.jquery.com/jquery-3.5.0.min.js']
  })

  t.is(version, '3.5.0')
})

test('setup `modules`', async t => {
  const browserless = await browserlessFactory.createContext()

  t.teardown(browserless.destroyContext)

  const getVersion = browserless.evaluate(async page => page.evaluate('jQuery.fn.jquery'))

  const version = await getVersion('https://github.com', {
    modules: ['https://code.jquery.com/jquery-3.5.0.min.js']
  })

  t.is(version, '3.5.0')
})

test('setup `styles`', async t => {
  const browserless = await browserlessFactory.createContext()

  t.teardown(browserless.destroyContext)

  const getStyle = browserless.evaluate(async page =>
    page.evaluate('window.getComputedStyle(document.body).fontFamily')
  )

  const style = await getStyle('https://github.com', {
    styles: ['https://cdn.jsdelivr.net/npm/bootstrap@3.4.1/dist/css/bootstrap.min.css']
  })

  t.is(style, '"Helvetica Neue", Helvetica, Arial, sans-serif')
})

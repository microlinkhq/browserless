'use strict'

const test = require('ava')
const createBrowserless = require('../src')

require('@browserless/test')(createBrowserless())

test('ensure to destroy browser contexts', async t => {
  const browserlessFactory = createBrowserless()
  const browser = await browserlessFactory.browser()
  t.teardown(() => browser.close())

  t.is(browser.browserContexts().length, 1)

  const browserless = await browserlessFactory.createContext()

  await browserless.context()

  t.is(browser.browserContexts().length, 2)

  await browserless.destroyContext()

  t.is(browser.browserContexts().length, 1)
})

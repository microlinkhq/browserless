'use strict'

const test = require('ava')
const createBrowserless = require('../src')

require('@browserless/test')(createBrowserless())
;['pdf', 'screenshot', 'html', 'text'].forEach(method => {
  test(`.${method} wrap errors`, async t => {
    const timeout = 50

    const browserlessFactory = createBrowserless({ timeout })
    const browserless = await browserlessFactory.createContext()

    t.teardown(() => browserless.destroyContext())

    const error = await t.throwsAsync(
      browserless[method]('https://example.com', { adblock: false, animations: true })
    )

    t.truthy(error)
    t.is(error.name, 'BrowserlessError')
    t.is(error.code, 'EBRWSRTIMEOUT')
    t.is(error.message, `EBRWSRTIMEOUT, Promise timed out after ${timeout} milliseconds`)
  })
})

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

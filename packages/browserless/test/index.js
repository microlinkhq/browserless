'use strict'

const test = require('ava')
const createBrowserless = require('../src')

const browserless = createBrowserless()

require('@browserless/test')(browserless)
;['pdf', 'screenshot', 'html', 'text'].forEach(method => {
  test(`.${method} wrap errors`, async t => {
    const timeout = 50
    const browserless = createBrowserless({ timeout })
    const error = await t.throwsAsync(
      browserless[method]('https://example.com', { adblock: false, animations: true })
    )

    t.is(error.name, 'BrowserlessError')
    t.is(error.code, 'EBRWSRTIMEOUT')
    t.is(error.message, `EBRWSRTIMEOUT, Promise timed out after ${timeout} milliseconds`)

    const browser = await browserless.browser()
    const pages = await browser.pages()

    t.is(pages.length, 1) // about:page is always open

    await browserless.close()
  })
})

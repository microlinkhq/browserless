'use strict'

const test = require('ava')
const createBrowserless = require('../src')

require('@browserless/test')(createBrowserless)
;['pdf', 'screenshot', 'html', 'text'].forEach(method => {
  test(`.${method} wrap errors`, async t => {
    const browserless = createBrowserless()
    const timeout = 50

    const error = await t.throwsAsync(
      browserless[method]('https://example.com', { timeout })
    )

    t.is(error.name, 'TimeoutError')
    t.is(error.message, `Navigation timeout of ${timeout} ms exceeded`)

    const browser = await browserless.browser
    const pages = await browser.pages()

    t.is(pages.length, 1) // about:page is always open
  })
})

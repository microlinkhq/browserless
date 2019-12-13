'use strict'

const test = require('ava')
const createBrowserless = require('../src')

require('@browserless/test')(createBrowserless)
;['pdf', 'screenshot', 'html', 'text'].forEach(method => {
  test(`.${method} wrap errors`, async t => {
    const timeout = 50
    const browserless = createBrowserless({ timeout })
    const error = await t.throwsAsync(browserless[method]('https://example.com'))

    t.is(error.name, 'TimeoutError')
    t.is(error.message, `Promise timed out after ${timeout} milliseconds`)

    const browser = await browserless.browser
    const pages = await browser.pages()

    t.is(pages.length, 1) // about:page is always open
  })
})

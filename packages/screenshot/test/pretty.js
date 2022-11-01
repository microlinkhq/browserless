'use strict'

const { getInternalBrowser } = require('@browserless/test/util')

const test = require('ava')

const pretty = require('../src/pretty')

test('prettify `application/json`', async t => {
  const browser = await getInternalBrowser()
  const page = await browser.newPage()

  t.teardown(() => page.close())

  const payload = {
    version: 2,
    status: 'success',
    data: {
      emoji: '<required> an URL for getting content.',
      vendor: "[optional] The vendor look and feel to be applied ('apple' by default)."
    },
    example: 'https://emojipedia-api.vercel.app?emoji=💩&vendor=skype',
    message: 'Welcome to Emojipedia unofficial API.',
    author: 'https://twitter.com/Kikobeats'
  }

  const response = {
    text: () => JSON.stringify(payload),
    headers: () => ({ 'content-type': 'application/json; charset=utf-8' })
  }

  const opts = {
    codeScheme: 'ghcolors',
    styles: [
      '#screenshot code.language-js{font-family:"Roboto Mono"}',
      '#screenshot .token{color:#f81ce5}'
    ]
  }
  await pretty(page, response, opts)
  const html = await page.content()

  t.snapshot(html)
})

test('prettify `text/plain`', async t => {
  const browser = await getInternalBrowser()
  const page = await browser.newPage()

  t.teardown(() => page.close())

  const payload = 'Open the network tab in devtools to see the response headers'

  const response = {
    text: () => payload,
    headers: () => ({ 'content-type': 'text/plain; charset=UTF-8' })
  }

  const opts = {
    codeScheme: 'ghcolors',
    styles: ['#screenshot code.language-text{font-family:"Roboto Mono";color:#f81ce5}']
  }
  await pretty(page, response, opts)
  const html = await page.content()

  t.snapshot(html)
})

test('prettify `text/html` markup is not HTML', async t => {
  const browser = await getInternalBrowser()
  const page = await browser.newPage()

  t.teardown(() => page.close())

  const payload = 'Open the network tab in devtools to see the response headers'

  const response = {
    text: () => payload,
    headers: () => ({ 'content-type': 'text/html; charset=UTF-8' })
  }

  const opts = {
    codeScheme: 'ghcolors',
    styles: ['#screenshot code.language-text{font-family:"Roboto Mono";color:#f81ce5}']
  }
  await pretty(page, response, opts)
  const html = await page.content()

  t.snapshot(html)
})

test("don't prettify `text/html` when markup is HTML", async t => {
  const browser = await getInternalBrowser()
  const page = await browser.newPage()

  t.teardown(() => page.close())

  const payload = '<html><head></head><body></body></html>'

  const response = {
    text: () => payload,
    headers: () => ({ 'content-type': 'text/html; charset=UTF-8' })
  }

  const opts = {
    codeScheme: 'ghcolors',
    styles: ['#screenshot code.language-text{font-family:"Roboto Mono";color:#f81ce5}']
  }
  await pretty(page, response, opts)
  const html = await page.content()

  t.snapshot(html)
})

test("don't prettify `text/plain` when markup is HTML", async t => {
  const browser = await getInternalBrowser()
  const page = await browser.newPage()

  t.teardown(() => page.close())

  const payload = '<html><head></head><body></body></html>'

  const response = {
    text: () => payload,
    headers: () => ({ 'content-type': 'text/plain; charset=UTF-8' })
  }

  const opts = {
    codeScheme: 'ghcolors',
    styles: ['#screenshot code.language-text{font-family:"Roboto Mono";color:#f81ce5}']
  }
  await pretty(page, response, opts)
  const html = await page.content()

  t.snapshot(html)
})

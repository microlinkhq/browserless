'use strict'

const { getBrowser } = require('@browserless/test')
const path = require('path')
const test = require('ava')

const browserless = getBrowser()

const fileUrl = `file://${path.join(__dirname, '../../function/test/fixtures/example.html')}`

const countPages = async context => (await (await context.browser()).pages()).length

test('a page is closed once evaluate resolves', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const before = await countPages(context)
  const title = await context.evaluate(page => page.title())(fileUrl)

  t.is(typeof title, 'string')
  t.is(await countPages(context), before)
})

test('keepPage leaves the page open for its new owner', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  let retained
  const before = await countPages(context)

  const title = await context.evaluate(
    page => {
      retained = page
      return page.title()
    },
    { keepPage: true }
  )(fileUrl)

  t.is(typeof title, 'string')
  t.false(retained.isClosed())
  t.is(await countPages(context), before + 1)
  t.is(await retained.title(), title)
})

test('keepPage still closes the page when the function throws', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  let retained
  const before = await countPages(context)

  await t.throwsAsync(
    context.evaluate(
      page => {
        retained = page
        throw new Error('boom')
      },
      { keepPage: true, retry: 0 }
    )(fileUrl)
  )

  t.true(retained.isClosed())
  t.is(await countPages(context), before)
})

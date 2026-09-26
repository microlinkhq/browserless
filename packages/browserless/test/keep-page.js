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
      { keepPage: true }
    )(fileUrl)
  )

  t.true(retained.isClosed())
  t.is(await countPages(context), before)
})

test('keepPage closes the page when the call times out', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  // The close watchdog is armed once the page exists, so it fires slightly
  // later than the call timeout. Hold the function until the call has
  // rejected, then let it return inside that gap. Retaining here would keep
  // the page open for another full timeout, with no caller holding it.
  const timeout = 2000
  let release
  const gate = new Promise(resolve => {
    release = resolve
  })
  t.teardown(() => release())

  let retained
  const before = await countPages(context)

  const error = await t.throwsAsync(
    context.evaluate(
      async page => {
        retained = page
        await gate
        return page
      },
      { keepPage: true, timeout }
    )(fileUrl)
  )

  t.is(error.code, 'EBRWSRTIMEOUT')
  release()

  const deadline = Date.now() + 1000
  while (!retained.isClosed() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20))
  }

  t.true(retained.isClosed())
  t.is(await countPages(context), before)
})

test('keepPage restarts the close watchdog at handover', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  // The watchdog and the evaluate timeout share one budget, measured from
  // page creation. Spend most of it here, then wait past that original
  // deadline but less than a full new window.
  const timeout = 8000
  const spent = 2000
  const afterHandover = 7000

  const retained = await context.evaluate(
    async page => {
      await new Promise(resolve => setTimeout(resolve, spent))
      return page
    },
    { keepPage: true, timeout }
  )(fileUrl)

  t.false(retained.isClosed())
  await new Promise(resolve => setTimeout(resolve, afterHandover))
  t.false(retained.isClosed())

  const deadline = Date.now() + timeout
  while (!retained.isClosed() && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 50))
  }
  t.true(retained.isClosed())
})

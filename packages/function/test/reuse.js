'use strict'

const { getBrowser } = require('@browserless/test')
const path = require('path')
const test = require('ava')

const browserlessFunction = require('..')()

const browserless = getBrowser()

const fileUrl = `file://${path.join(__dirname, './fixtures/example.html')}`

const TITLE_FN = '({ page }) => page.title()'

const spyContext = context => {
  let destroyed = 0
  return {
    calls: () => destroyed,
    context: Object.assign(Object.create(Object.getPrototypeOf(context)), context, {
      destroyContext: (...args) => {
        destroyed++
        return context.destroyContext(...args)
      }
    })
  }
}

test('by default the context it created is destroyed', async t => {
  const real = await browserless.createContext()
  const spy = spyContext(real)

  const result = await browserlessFunction(TITLE_FN, {
    getBrowserless: () => ({ createContext: async () => spy.context }),
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(spy.calls(), 1)
})

test('ownsContext false leaves the context to its owner', async t => {
  const real = await browserless.createContext()
  const spy = spyContext(real)
  t.teardown(() => real.destroyContext())

  const result = await browserlessFunction(TITLE_FN, {
    getBrowserless: () => ({ createContext: async () => spy.context }),
    ownsContext: false,
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(spy.calls(), 0)
  t.false((await real.browser()).connected === false)
})

test('getPage runs on the handed-over page without navigating or closing it', async t => {
  const context = await browserless.createContext()
  t.teardown(() => context.destroyContext())

  const page = await context.page('handover')
  await page.goto(fileUrl)
  // A marker only this page carries: a fresh navigation of the same fixture
  // would return the file's own title, so the assertion cannot pass by accident.
  await page.evaluate(() => {
    document.title = 'HANDOVER-MARKER'
  })

  let gotoCalls = 0
  const realGoto = page.goto.bind(page)
  page.goto = (...args) => {
    gotoCalls++
    return realGoto(...args)
  }

  const result = await browserlessFunction(TITLE_FN, {
    getPage: async () => ({ page }),
    timeout: 120000
  })(fileUrl)

  t.true(result.isFulfilled)
  t.is(result.value, 'HANDOVER-MARKER')
  t.is(gotoCalls, 0)
  t.false(page.isClosed())
})

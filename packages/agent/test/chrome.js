'use strict'

const test = require('ava')
const puppeteer = require('puppeteer')
const { observe, execute } = require('../src/browser')
const { StaleDecisionError } = require('../src/errors')

const GENERATED_TEXT = 'bmw x3'

let browser
test.before(async () => {
  browser = await puppeteer.launch({ args: ['--no-sandbox'] })
})
test.after.always(() => browser?.close())

const open = async (t, html) => {
  const page = await browser.newPage()
  t.teardown(() => page.close())
  await page.setContent(html)
  return page
}

const fill = async (page, label, text = GENERATED_TEXT) => {
  const state = await observe(page)
  const action = state.actions.find(a => a.kind === 'fill' && a.label === label)
  return execute(page, state, action, text, 0)
}

const REPLACEMENTS_BY_INPUT_TYPE = {
  text: ['old', 'new'],
  search: ['old', 'new'],
  number: ['12', '345'],
  email: ['old@example.com', 'new@example.com'],
  url: ['https://old.example', 'https://new.example'],
  tel: ['111', '222']
}

for (const [type, [previous, next]] of Object.entries(REPLACEMENTS_BY_INPUT_TYPE)) {
  test(`typing replaces the existing value of input type=${type}`, async t => {
    const page = await open(t, `<input type="${type}" aria-label="Field" value="${previous}">`)
    await fill(page, 'Field', next)
    t.is(await page.$eval('input', e => e.value), next)
  })
}

test('input types that cannot take inserted text are never fill targets', async t => {
  const page = await open(
    t,
    ['date', 'time', 'range', 'color'].map(type => `<input type="${type}">`).join('')
  )
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'fill'),
    []
  )
})

test('typing replaces the existing value of an input', async t => {
  const page = await open(t, '<input aria-label="Search" value="old">')
  await fill(page, 'Search')
  t.is(await page.$eval('input', e => e.value), GENERATED_TEXT)
})

test('typing replaces the existing content of an editing host', async t => {
  const page = await open(t, '<div contenteditable aria-label="Notes">old <b>text</b></div>')
  await fill(page, 'Notes')
  t.is(await page.$eval('div', e => e.innerText), GENERATED_TEXT)
})

test('typing is discarded when the page moves focus to another control', async t => {
  const page = await open(
    t,
    '<input id="target" aria-label="Search"><input id="thief" aria-label="Other">'
  )
  await page.$eval('#target', e =>
    e.addEventListener('focus', () => document.getElementById('thief').focus())
  )
  await t.throwsAsync(fill(page, 'Search'), { instanceOf: StaleDecisionError })
  t.deepEqual(await page.$$eval('input', inputs => inputs.map(e => e.value)), ['', ''])
})

test('controls that cannot take keyboard text are never fill targets', async t => {
  const page = await open(
    t,
    '<div role="textbox" aria-label="Fake">x</div><div contenteditable aria-label="Host">a <b contenteditable="true" aria-label="Nested">b</b></div>'
  )
  const { actions } = await observe(page)
  t.deepEqual(
    actions.filter(a => a.kind === 'fill').map(a => a.label),
    ['Host']
  )
})

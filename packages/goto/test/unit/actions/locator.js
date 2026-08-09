'use strict'

const test = require('ava')

const { toSelector, hasElementLocator, escape } = require('../../../src/actions/locator')

test('toSelector compiles CSS selector pass-through', t => {
  t.is(toSelector({ selector: '#checkout' }), '#checkout')
})

test('toSelector compiles role + name to P-aria', t => {
  t.is(toSelector({ role: 'button', name: 'Submit' }), '::-p-aria([role="button"][name="Submit"])')
})

test('toSelector compiles role without name', t => {
  t.is(toSelector({ role: 'textbox' }), '::-p-aria([role="textbox"])')
})

test('toSelector compiles text / label / placeholder / testId / alt', t => {
  t.is(toSelector({ text: 'Sign in' }), '::-p-text(Sign in)')
  t.is(toSelector({ label: 'Email' }), '::-p-aria([name="Email"])')
  t.is(toSelector({ placeholder: 'Search…' }), '[placeholder="Search…"]')
  t.is(toSelector({ testId: 'submit-btn' }), '[data-testid="submit-btn"]')
  t.is(toSelector({ alt: 'Logo' }), '[alt="Logo"]')
})

test('toSelector escapes quotes in role name', t => {
  t.is(
    toSelector({ role: 'button', name: 'Say "hi"' }),
    '::-p-aria([role="button"][name="Say \\"hi\\""])'
  )
})

test('toSelector throws without strategy', t => {
  t.throws(() => toSelector({ type: 'click' }), { message: 'locator: no strategy' })
})

test('hasElementLocator treats wait text as page-text mode', t => {
  t.false(hasElementLocator({ type: 'wait', text: 'Dashboard' }))
  t.true(hasElementLocator({ type: 'wait', role: 'button', name: 'Submit' }))
  t.true(hasElementLocator({ type: 'click', text: 'Accept' }))
})

test('escape quotes double quotes', t => {
  t.is(escape('a"b'), 'a\\"b')
})

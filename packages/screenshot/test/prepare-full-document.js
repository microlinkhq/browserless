'use strict'

const test = require('ava')

const {
  prepareFullDocument,
  isCompleteScroll
} = require('../src/prepare-full-document')

test('prepareFullDocument tolerates navigation during the scroll', async t => {
  const goto = {
    timeouts: {
      action: () => 1000,
      goto: () => 1000
    }
  }

  const page = {
    evaluate: async () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation.')
    }
  }

  const result = await prepareFullDocument(page, { goto, timeout: 1000 })
  t.is(result.expanded, false)
  t.is(result.scrolled, false)
  t.true(typeof result.duration === 'number')
})

test('isCompleteScroll requires reaching the document end', t => {
  t.false(
    isCompleteScroll({
      hasOverflow: true,
      pageHeight: 4000,
      viewport: 800,
      scrolledPx: 800
    })
  )
  t.true(
    isCompleteScroll({
      hasOverflow: true,
      pageHeight: 4000,
      viewport: 800,
      scrolledPx: 3200
    })
  )
  t.false(
    isCompleteScroll({
      hasOverflow: false,
      pageHeight: 4000,
      viewport: 800,
      scrolledPx: 4000
    })
  )
})

test('prepareFullDocument skips scroll only after a complete hydrate', async t => {
  const goto = {
    timeouts: {
      action: () => 1000,
      goto: () => 1000
    }
  }

  let evaluateCalls = 0
  const page = {
    evaluate: async () => {
      evaluateCalls += 1
      return false
    },
    waitForNetworkIdle: async () => {}
  }

  const partial = await prepareFullDocument(page, {
    goto,
    timeout: 1000,
    scrolled: isCompleteScroll({
      hasOverflow: true,
      pageHeight: 4000,
      viewport: 800,
      scrolledPx: 800
    })
  })
  t.is(partial.scrolled, false)
  t.true(evaluateCalls > 0)

  evaluateCalls = 0
  const complete = await prepareFullDocument(page, {
    goto,
    timeout: 1000,
    scrolled: isCompleteScroll({
      hasOverflow: true,
      pageHeight: 4000,
      viewport: 800,
      scrolledPx: 3200
    })
  })
  t.is(complete.scrolled, true)
  t.is(evaluateCalls, 1)
})

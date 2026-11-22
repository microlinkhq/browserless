'use strict'

const vm = require('vm')
const { default: test } = require('ava')

const { prepareFullDocument, isCompleteScroll } = require('../src/prepare-full-document')

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

test('prepareFullDocument returns to the top after consent', async t => {
  const order = []
  const sandbox = {
    window: {
      scrollY: 2500,
      scrollTo (x, y) {
        this.scrollY = y
      }
    }
  }
  const evaluate = async fn => {
    const source = Function.prototype.toString.call(fn)
    if (source.includes('scrollTo(0, 0)') && !source.includes('scrollBy')) {
      order.push('scroll')
      vm.runInNewContext(`(${source})()`, sandbox)
    }
    return false
  }
  const page = {
    evaluate,
    waitForNetworkIdle: async () => {},
    mainFrame: () => ({ isolatedRealm: () => ({ evaluate }) })
  }
  const goto = {
    timeouts: {
      action: () => 222,
      goto: () => 1000
    },
    waitForConsent: async (waited, opts) => {
      order.push('consent')
      t.is(waited, page)
      t.is(opts.timeout, 222)
      t.is(opts.detectFor, 0)
    }
  }

  await prepareFullDocument(page, { goto, timeout: 1000, scrolled: true })

  t.deepEqual(order, ['consent', 'scroll'])
  t.is(sandbox.window.scrollY, 0)
})

const INNER_HEIGHT = 800

const consentWindow = async scenario => {
  const sandbox = {
    window: { innerHeight: INNER_HEIGHT, scrollY: 0, scrollTo () {} },
    document: {}
  }
  let value
  let thrown = false
  let detectFor
  const evaluate = async (fn, minPx) => {
    if (scenario === 'throws') throw new Error('context destroyed')
    const source = Function.prototype.toString.call(fn)
    if (!source.startsWith('function isScrollLocked')) return false
    const inner = sandbox.window.innerHeight
    const documentElement = { scrollHeight: scenario === 'tall-root' ? inner + 2 : inner + 1 }
    const body = {
      scrollHeight: scenario === 'short-body' ? inner + minPx : inner + minPx + 1
    }
    sandbox.document.documentElement = documentElement
    sandbox.document.body = scenario === 'no-body' ? null : body
    sandbox.document.scrollingElement = scenario === 'no-scrolling-element' ? null : documentElement
    try {
      value = vm.runInNewContext(`(${source})(${minPx})`, sandbox)
      return value
    } catch (error) {
      thrown = true
      throw error
    }
  }
  const page = {
    waitForNetworkIdle: async () => {},
    mainFrame: () => ({ isolatedRealm: () => ({ evaluate }) })
  }
  const goto = {
    timeouts: { action: () => 1000, goto: () => 1000 },
    waitForConsent: async (_page, opts) => {
      detectFor = opts.detectFor
    }
  }
  await prepareFullDocument(page, { goto, timeout: 1000, scrolled: true })
  return { value, thrown, detectFor }
}

test('a viewport-sized root with a taller body asks for the longer detection window', async t => {
  const result = await consentWindow('locked')
  t.false(result.thrown)
  t.true(result.value)
  t.is(result.detectFor, 750)
})

test('a root one pixel past the slack is not scroll-locked', async t => {
  const result = await consentWindow('tall-root')
  t.false(result.thrown)
  t.false(result.value)
  t.is(result.detectFor, 0)
})

test('a body only as tall as the overflow minimum is not scroll-locked', async t => {
  const result = await consentWindow('short-body')
  t.false(result.thrown)
  t.false(result.value)
  t.is(result.detectFor, 0)
})

test('a document with no body is not scroll-locked', async t => {
  const result = await consentWindow('no-body')
  t.false(result.thrown)
  t.false(result.value)
  t.is(result.detectFor, 0)
})

test('a document without a scrolling element uses the document element', async t => {
  const result = await consentWindow('no-scrolling-element')
  t.false(result.thrown)
  t.true(result.value)
  t.is(result.detectFor, 750)
})

test('a scroll-lock check that throws keeps the normal detection window', async t => {
  const result = await consentWindow('throws')
  t.is(result.detectFor, 0)
})

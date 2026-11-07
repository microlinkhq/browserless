'use strict'

const { getBrowserContext, getPage } = require('@browserless/test')
const { default: test } = require('ava')

const POLLING_INTERVAL_MS = 100

const waitForText = async (page, readText) => {
  // Puppeteer's 30s default would abandon a slow demo the previous loop waited out.
  // The browserless context timeout stays the bound.
  const handle = await page.waitForFunction(readText, {
    polling: POLLING_INTERVAL_MS,
    timeout: 0
  })
  return handle.jsonValue()
}

const readCreepjsHash = () => {
  const hash = document.querySelector('.fingerprint-header div')?.innerText.split(': ')[1]
  return hash !== 'Computing...' && hash
}

const readGiantText = () => document.querySelector('.giant')?.innerText

const outcomeWithin = (promise, ms) =>
  Promise.race([
    promise.then(
      value => ({ state: 'resolved', value }),
      error => ({ state: 'rejected', error })
    ),
    new Promise(resolve => setTimeout(() => resolve({ state: 'pending' }), ms))
  ])

const assertPending = async (t, promise) => {
  const outcome = await outcomeWithin(promise, 350)
  t.is(outcome.state, 'pending', outcome.error && outcome.error.message)
}

test('creepjs hash waits out a missing header and Computing...', async t => {
  const page = await getPage(t)
  await page.setContent('<div id="root"></div>')

  const pending = waitForText(page, readCreepjsHash)
  await assertPending(t, pending)

  await page.evaluate(() => {
    document.getElementById('root').innerHTML =
      '<div class="fingerprint-header"><div>FP ID</div></div>'
  })
  await assertPending(t, pending)

  await page.evaluate(() => {
    document.querySelector('.fingerprint-header div').textContent = 'FP ID: '
  })
  await assertPending(t, pending)

  await page.evaluate(() => {
    document.querySelector('.fingerprint-header div').textContent = 'FP ID: Computing...'
  })
  await assertPending(t, pending)

  await page.evaluate(() => {
    document.querySelector('.fingerprint-header div').textContent = 'FP ID: abc123'
  })
  t.is(await pending, 'abc123')
})

test('fingerprintjs text waits out a missing or empty .giant', async t => {
  const page = await getPage(t)
  await page.setContent('<div id="root"></div>')

  const pending = waitForText(page, readGiantText)
  await assertPending(t, pending)

  await page.evaluate(() => {
    document.getElementById('root').innerHTML = '<pre class="giant"></pre>'
  })
  await assertPending(t, pending)

  await page.evaluate(() => {
    document.querySelector('.giant').textContent = 'visitor'
  })
  t.is(await pending, 'visitor')
})

test('waitForText keeps polling when the page default timeout is short', async t => {
  const page = await getPage(t)
  page.setDefaultTimeout(300)
  await page.setContent('<div id="root"></div>')

  const pending = waitForText(page, readGiantText)
  const outcome = await outcomeWithin(pending, 800)
  t.is(outcome.state, 'pending', outcome.error && outcome.error.message)

  await page.evaluate(() => {
    document.getElementById('root').innerHTML = '<pre class="giant">visitor</pre>'
  })
  t.is(await pending, 'visitor')
})

test('waitForText asks for a 100ms poll and no puppeteer timeout', async t => {
  const calls = []
  const readText = () => 'hash'
  const page = {
    waitForFunction: async (fn, options) => {
      calls.push({ fn, options })
      return { jsonValue: async () => fn() }
    }
  }

  t.is(await waitForText(page, readText), 'hash')
  t.deepEqual(calls, [{ fn: readText, options: { polling: POLLING_INTERVAL_MS, timeout: 0 } }])
})

test('waitForText polls every 100ms', async t => {
  t.timeout(10000)
  const page = await getPage(t)
  await page.setContent('<p></p>')

  const started = Date.now()
  const value = await waitForText(page, () => {
    const calls = Number(document.body.dataset.calls || 0) + 1
    document.body.dataset.calls = String(calls)
    return calls >= 6 ? 'ready' : ''
  })
  const elapsed = Date.now() - started

  t.is(value, 'ready')
  // 5 intervals of 100ms. `raf` finishes in a few frames; a 200ms interval takes ~1s.
  t.true(elapsed >= 400 && elapsed < 900, `elapsed ${elapsed}`)
})

test('creepjs', async t => {
  const browserless = await getBrowserContext(t)

  const fingerprint = await browserless.evaluate(page => waitForText(page, readCreepjsHash))

  const [fingerprintOne, fingerprintTwo] = await Promise.all([
    fingerprint('https://abrahamjuliot.github.io/creepjs/', { timezone: 'Europe/Madrid' }),
    fingerprint('https://abrahamjuliot.github.io/creepjs/', { timezone: 'Europe/Paris' })
  ])

  t.true(fingerprintOne !== fingerprintTwo)
})

test('fingerprintjs', async t => {
  const browserless = await getBrowserContext(t, { retry: 0, timeout: 20000 })

  const fingerprint = await browserless.evaluate(page => waitForText(page, readGiantText))

  const fingerprintOne = await fingerprint('https://fingerprintjs.github.io/fingerprintjs/', {
    timezone: 'Europe/Madrid'
  })
  const fingerprintTwo = await fingerprint('https://fingerprintjs.github.io/fingerprintjs/', {
    timezone: 'Europe/Paris'
  })

  t.true(fingerprintOne !== fingerprintTwo)
})

test('amiunique.org/fp', async t => {
  const browserless = await getBrowserContext(t, { retry: 0, timeout: 45000 })
  const content = await browserless.text('https://amiunique.org/fingerprint', {
    waitForFunction: "document.body.innerText.includes('HTTP HEADERS ATTRIBUTES')"
  })
  t.true(content.includes('User agent'))
})

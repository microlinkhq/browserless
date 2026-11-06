'use strict'

const { getBrowserContext } = require('@browserless/test')
const { default: test } = require('ava')

const POLLING_INTERVAL_MS = 100

const waitForText = async (page, readText) => {
  const handle = await page.waitForFunction(readText, { polling: POLLING_INTERVAL_MS })
  return handle.jsonValue()
}

test('creepjs', async t => {
  const browserless = await getBrowserContext(t)

  const fingerprint = await browserless.evaluate(page =>
    waitForText(page, () => {
      const hash = document.querySelector('.fingerprint-header div')?.innerText.split(': ')[1]
      return hash !== 'Computing...' && hash
    })
  )

  const [fingerprintOne, fingerprintTwo] = await Promise.all([
    fingerprint('https://abrahamjuliot.github.io/creepjs/', { timezone: 'Europe/Madrid' }),
    fingerprint('https://abrahamjuliot.github.io/creepjs/', { timezone: 'Europe/Paris' })
  ])

  t.true(fingerprintOne !== fingerprintTwo)
})

test('fingerprintjs', async t => {
  const browserless = await getBrowserContext(t, { retry: 0, timeout: 20000 })

  const fingerprint = await browserless.evaluate(page =>
    waitForText(page, () => document.querySelector('.giant')?.innerText)
  )

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

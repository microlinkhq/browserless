'use strict'

const { getBrowserContext } = require('@browserless/test')
const test = require('ava')

test('creepjs', async t => {
  const browserless = await getBrowserContext(t)

  const fingerprint = await browserless.evaluate(page =>
    page.evaluate(async () => {
      const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
      let result = 'Computing...'
      do {
        await delay(100)
        result = document.querySelector('.fingerprint-header div').innerText.split(': ')[1]
      } while (result === 'Computing...')
      return result
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
    page.evaluate("document.querySelector('.giant').innerText")
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

const lineAfter = (text, label) => {
  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  const index = lines.findIndex(line => line.toUpperCase() === label.toUpperCase())
  return index >= 0 ? lines[index + 1] : null
}

test('fingerprint-scan.com', async t => {
  const browserless = await getBrowserContext(t, { retry: 0, timeout: 45000 })
  const content = await browserless.text('https://fingerprint-scan.com/', {
    waitForFunction: "document.body.innerText.includes('Fingerprint collected successfully')"
  })

  t.regex(lineAfter(content, 'FINGERPRINT HASH'), /^[a-f0-9]{16}$/)
  t.is(lineAfter(content, 'Webdriver'), 'false')
  t.is(lineAfter(content, 'Playwright Flags'), 'false')
  t.is(lineAfter(content, 'Chrome Driver Flags'), 'false')
  t.is(lineAfter(content, 'Selenium Properties'), 'false')
})

test('detectincognito.com', async t => {
  const browserless = await getBrowserContext(t, { retry: 0, timeout: 45000 })
  const content = await browserless.text('https://detectincognito.com/', {
    waitForFunction:
      "document.body.innerText.includes('Yes. You are') || document.body.innerText.includes('No. You are')"
  })

  t.true(/Yes\. You are|No\. You are/.test(content))
  t.true(content.includes('Chrome'))
})

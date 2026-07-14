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
  const browserless = await getBrowserContext(t)

  const fingerprint = await browserless.evaluate(page =>
    page.evaluate("document.querySelector('.giant').innerText")
  )

  const [fingerprintOne, fingerprintTwo] = await Promise.all([
    fingerprint('https://fingerprintjs.github.io/fingerprintjs/', { timezone: 'Europe/Madrid' }),
    fingerprint('https://fingerprintjs.github.io/fingerprintjs/', { timezone: 'Europe/Paris' })
  ])

  t.true(fingerprintOne !== fingerprintTwo)
})

test('amiunique.org/fp', async t => {
  const browserless = await getBrowserContext(t)
  const content = await browserless.text('https://amiunique.org/fingerprint', {
    waitForSelector:
      '#app > div > main > div > div > section > div:nth-child(2) > div > div > div.v-card__text.title.green--text.pb-0'
  })
  t.true(content.includes('You are unique'))
})

'use strict'

const test = require('ava')

const createBrowserless = require('browserless')
const userAgent = require('ua-string')

const { evasions } = require('../..')

test('arh.antoinevastel.com/bots/areyouheadless', async t => {
  const browserless = createBrowserless({ evasions })
  const content = await browserless.text('https://arh.antoinevastel.com/bots/areyouheadless')
  t.true(content.includes('You are not Chrome headless'))
})

// See https://antoinevastel.com/bot%20detection/2018/11/13/fp-scanner-library-demo.html
test('antoinevastel.com/bots/fpstructured', async t => {
  const browserless = createBrowserless({ evasions })
  const fpCollect = browserless.evaluate((page, response) =>
    page.evaluate(() => {
      const fp = JSON.parse(document.getElementById('fp').innerText)
      const scanner = JSON.parse(document.getElementById('scanner').innerText)
      return { fp, scanner }
    })
  )

  const { scanner } = await fpCollect('https://antoinevastel.com/bots/fpstructured')
  Object.keys(scanner)
    // looks it isn't accurate,
    // see https://github.com/antoinevastel/fpscanner/issues/9
    .filter(key => key !== 'CHR_MEMORY')
    .forEach(scannerKey => {
      const scannerValue = scanner[scannerKey]
      t.true(scannerValue.consistent === 3, `${scannerKey} is inconsistent`)
    })
})

test('device-info.fr/are_you_a_bot', async t => {
  const browserless = createBrowserless({
    evasions: evasions.filter(evasion => evasion !== 'randomizeUserAgent')
  })
  const content = await browserless.text('https://device-info.fr/are_you_a_bot', {
    headers: {
      // the test false/positive under some popular user agents
      // so we setup a fixed value
      'user-agent': userAgent
    }
  })
  t.true(content.includes('You are human!'))
})

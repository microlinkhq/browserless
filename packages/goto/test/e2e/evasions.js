'use strict'

const test = require('ava')

const createBrowserless = require('browserless')
const userAgent = require('ua-string')

const { evasions } = require('../..')

test('arh.antoinevastel.com/bots/areyouheadless', async t => {
  const browserless = createBrowserless()
  const content = await browserless.text('https://arh.antoinevastel.com/bots/areyouheadless')
  t.true(content.includes('You are not Chrome headless'))
})

// See https://antoinevastel.com/bot%20detection/2018/11/13/fp-scanner-library-demo.html
test('antoinevastel.com/bots/fpstructured', async t => {
  const browserless = createBrowserless()
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

test('bot.sannysoft.com', async t => {
  const browserless = createBrowserless()

  const getReport = browserless.evaluate(page =>
    page.evaluate(() => {
      return {
        userAgent: document.getElementById('user-agent-result').classList.contains('passed'),
        webdriver: document.getElementById('webdriver-result').classList.contains('passed'),
        webdriverAdvanced: document
          .getElementById('advanced-webdriver-result')
          .classList.contains('passed'),
        chrome: document.getElementById('chrome-result').classList.contains('passed'),
        permissions: document.getElementById('permissions-result').classList.contains('passed'),
        pluginsLength: document
          .getElementById('plugins-length-result')
          .classList.contains('passed'),
        pluginsType: document.getElementById('plugins-type-result').classList.contains('passed'),
        languages: document.getElementById('languages-result').classList.contains('passed'),
        webglVendor: document.getElementById('webgl-vendor').classList.contains('passed'),
        webglRenderer: document.getElementById('webgl-renderer').classList.contains('passed'),
        brokenImageDimensions: document
          .getElementById('broken-image-dimensions')
          .classList.contains('passed')
      }
    })
  )

  const report = await getReport('https://bot.sannysoft.com/')

  t.deepEqual(report, {
    userAgent: true,
    webdriver: true,
    webdriverAdvanced: true,
    chrome: true,
    permissions: true,
    pluginsLength: true,
    pluginsType: true,
    languages: true,
    webglVendor: true,
    webglRenderer: true,
    brokenImageDimensions: true
  })
})

test('amiunique.org/fp', async t => {
  const browserless = createBrowserless({ evasions })
  const content = await browserless.text('https://amiunique.org/fp')
  t.false(content.includes('You can be tracked'))
})

test('browserleaks.com/webgl', async t => {
  const browserless = createBrowserless({ evasions })

  const getGpuInfo = browserless.evaluate(page =>
    page.evaluate(() => {
      return {
        vendor: document.getElementById('f_unmasked_vendor').textContent,
        renderer: document.getElementById('f_unmasked_renderer').textContent
      }
    })
  )

  const gpuInfo = await getGpuInfo('https://browserleaks.com/webgl')

  t.deepEqual(gpuInfo, {
    vendor: '! Intel Inc.',
    renderer: '! Intel(R) Iris(TM) Plus Graphics 640'
  })
})

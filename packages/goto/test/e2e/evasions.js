'use strict'

const test = require('ava')

const browserlessFactory = require('browserless')()
const exitHook = require('exit-hook')

exitHook(browserlessFactory.close)

test.skip('arh.antoinevastel.com/bots/areyouheadless', async t => {
  const browserless = await browserlessFactory.createContext()
  t.teardown(() => browserless.destroyContext())
  const content = await browserless.text('https://arh.antoinevastel.com/bots/areyouheadless')
  t.true(content.includes('You are not Chrome headless'))
})

// See https://antoinevastel.com/bot%20detection/2018/11/13/fp-scanner-library-demo.html
test('antoinevastel.com/bots/fpstructured', async t => {
  const browserless = await browserlessFactory.createContext()
  t.teardown(() => browserless.destroyContext())
  const fpCollect = browserless.evaluate(page =>
    page.evaluate(() => {
      const fp = JSON.parse(document.getElementById('fp').innerText)
      const scanner = JSON.parse(document.getElementById('scanner').innerText)
      return { fp, scanner }
    })
  )

  const { scanner } = await fpCollect('https://antoinevastel.com/bots/fpstructured')

  // looks it isn't accurate,
  // see https://github.com/antoinevastel/fpscanner/issues/9
  const scannerProps = Object.keys(scanner).filter(key => key !== 'CHR_MEMORY')

  const scannerDetections = Object.keys(scannerProps).filter(key => {
    const value = scanner[key]
    return value && value.consistent !== 3
  })

  t.is(scannerDetections.length, 0, scannerDetections.toString())
})

test('bot.sannysoft.com', async t => {
  const browserless = await browserlessFactory.createContext()
  t.teardown(() => browserless.destroyContext())

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
  const browserless = await browserlessFactory.createContext()
  t.teardown(() => browserless.destroyContext())
  const content = await browserless.text('https://amiunique.org/fp')
  t.false(content.includes('You can be tracked'))
})

test('browserleaks.com/webgl', async t => {
  const browserless = await browserlessFactory.createContext()
  t.teardown(() => browserless.destroyContext())
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

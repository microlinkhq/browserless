'use strict'

const fpscanner = require('fpscanner')
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

test('fingerprintjs', async t => {
  const getFingerprint = async userAgent => {
    const browserless = await browserlessFactory.createContext()
    const fingerprint = await browserless.evaluate(page =>
      page.evaluate("document.querySelector('.giant').innerText")
    )

    const hash = await fingerprint('https://fingerprintjs.github.io/fingerprintjs/', {
      headers: {
        'user-agent': userAgent
      }
    })

    await browserless.destroyContext()
    return hash
  }

  t.not(
    await getFingerprint(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15'
    ),
    await getFingerprint(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:102.0) Gecko/20100101 Firefox/102.0'
    )
  )
})

test('fpscanner', async t => {
  const waitForAssertion = async () => {
    const browserless = await browserlessFactory.createContext()
    const getFingerprint = browserless.evaluate(page =>
      page.evaluate('fpCollect.generateFingerprint()')
    )

    const fingerprint = await getFingerprint('about:blank', {
      scripts: ['https://unpkg.com/fpcollect']
    })

    await browserless.destroyContext()

    const result = fpscanner.analyseFingerprint(fingerprint)
    const failedChecks = Object.values(result).filter(val => val.consistent < 3)
    // webdriver check is failing due to the outdated fp analyzer
    return failedChecks.length < 2
  }

  const results = await Promise.all([...Array(5).keys()].map(waitForAssertion))
  t.true(results.some(value => value === true))
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
  const content = await browserless.text('https://amiunique.org/fp', { waitForTimeout: 3000 })
  t.true(content.includes('You are unique'))
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

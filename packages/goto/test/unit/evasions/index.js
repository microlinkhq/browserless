'use strict'

const { getPage, createBrowser } = require('@browserless/test/util')
const test = require('ava')
const path = require('path')

const evasions = require('../../../src/evasions')

const fileUrl = `file://${path.join(__dirname, '../../fixtures/dummy.html')}`

const browser = createBrowser({ evasions: false })

test('ensure `window.console` is present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const consoleKeys = () => page.evaluate('Object.keys(window.console)')

  t.deepEqual(await consoleKeys(), [
    'debug',
    'error',
    'info',
    'log',
    'warn',
    'dir',
    'dirxml',
    'table',
    'trace',
    'group',
    'groupCollapsed',
    'groupEnd',
    'clear',
    'count',
    'countReset',
    'assert',
    'profile',
    'profileEnd',
    'time',
    'timeLog',
    'timeEnd',
    'timeStamp',
    'context',
    'createTask',
    'memory'
  ])
})

test('ensure `window.outerHeight` is present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const outerHeight = () => page.evaluate(() => window.outerHeight)

  await evasions.windowFrame(page)
  await page.goto(fileUrl)

  t.true((await outerHeight()) > 0)
})

test('ensure `window.outerWidth` is present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const outerWidth = () => page.evaluate(() => window.outerWidth)

  await evasions.windowFrame(page)
  await page.goto(fileUrl)

  t.true((await outerWidth()) > 0)
})

test('`navigator.vendor` is synchronized with user-agent', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const navigatorVendor = () => page.evaluate('navigator.vendor')

  t.is(await navigatorVendor(), 'Google Inc.')

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.5 Safari/605.1.15'
  )

  await evasions.navigatorVendor(page)
  await page.goto(fileUrl)

  t.is(await navigatorVendor(), 'Apple Computer, Inc.')

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:102.0) Gecko/20100101 Firefox/102.0'
  )

  await page.goto(fileUrl)
  t.is(await navigatorVendor(), '')
})

test('ensure `navigator.deviceMemory` is present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  await page.goto(fileUrl)

  const deviceMemory = () => page.evaluate('navigator.deviceMemory')

  t.truthy(await deviceMemory())
})

test('`window.navigator.userAgent` is not bot', async t => {
  const page = await getPage(t)
  const userAgent = () => page.evaluate('window.navigator.userAgent')
  t.false(/HeadlessChrome/.test(await userAgent()))
})

test('hide `navigator.webdriver`', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const webdriver = () => page.evaluate(() => window.navigator.webdriver)
  const javaEnabled = () => page.evaluate(() => navigator.javaEnabled())

  await page.goto(fileUrl)
  t.is(await webdriver(), false)
  t.is(await javaEnabled(), false)
})

test('ensure `navigator.hardwareConcurrency` is present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const hardwareConcurrency = () => page.evaluate(() => window.navigator.hardwareConcurrency)

  await page.goto(fileUrl)

  const n = await hardwareConcurrency()

  t.true(typeof n === 'number')
  t.true(n !== 0)
})

test('`window.chrome` is defined', async t => {
  const page = await getPage(t)
  const windowChrome = await page.evaluate('window.chrome')
  t.snapshot(windowChrome)
})

test('override `navigator.permissions`', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const permissionStatusState = () =>
    page.evaluate(async () => {
      const permissionStatus = await navigator.permissions.query({
        name: 'notifications'
      })
      return permissionStatus.state
    })

  t.is(await permissionStatusState(), 'prompt')

  await evasions.navigatorPermissions(page)
  await page.goto(fileUrl)

  t.is(await permissionStatusState(), 'denied')
})

test('mock `navigator.plugins`', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const plugins = () => page.evaluate(() => window.navigator.plugins.length)
  const mimeTypes = () => page.evaluate(() => window.navigator.mimeTypes.length)

  t.is(await plugins(), 0)
  t.is(await mimeTypes(), 0)

  await evasions.navigatorPlugins(page)
  await page.goto(fileUrl)

  t.is(await plugins(), 3)
  t.is(await mimeTypes(), 4)
})

test('ensure `navigator.languages` is present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const languages = () => page.evaluate(() => window.navigator.languages)
  t.deepEqual(await languages(), ['en-US'])
})

test('ensure media codecs are present', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  await page.goto(fileUrl, { waitUntil: 'networkidle0' })

  const videoCodecs = () =>
    page.evaluate(() => {
      const el = document.createElement('video')
      if (!el.canPlayType) return { ogg: 'unknown', h264: 'unknown', webm: 'unknown' }
      return {
        ogg: el.canPlayType('video/ogg; codecs="theora"'),
        h264: el.canPlayType('video/mp4; codecs="avc1.42E01E"'),
        webm: el.canPlayType('video/webm; codecs="vp8, vorbis"')
      }
    })

  const audioCodecs = () =>
    page.evaluate(() => {
      const el = document.createElement('audio')
      if (!el.canPlayType) {
        return { ogg: 'unknown', mp3: 'unknown', wav: 'unknown', m4a: 'unknown', aac: 'unknown' }
      }
      return {
        ogg: el.canPlayType('audio/ogg; codecs="vorbis"'),
        mp3: el.canPlayType('audio/mpeg;'),
        wav: el.canPlayType('audio/wav; codecs="1"'),
        m4a: el.canPlayType('audio/x-m4a;'),
        aac: el.canPlayType('audio/aac;')
      }
    })

  t.deepEqual(await videoCodecs(), { ogg: 'probably', h264: '', webm: 'probably' })

  t.deepEqual(await audioCodecs(), {
    ogg: 'probably',
    mp3: 'probably',
    wav: 'probably',
    m4a: '',
    aac: ''
  })

  await evasions.mediaCodecs(page)
  await page.goto(fileUrl)

  t.deepEqual(await videoCodecs(), { ogg: 'probably', h264: 'probably', webm: 'probably' })

  t.deepEqual(await audioCodecs(), {
    ogg: 'probably',
    mp3: 'probably',
    wav: 'probably',
    m4a: 'maybe',
    aac: 'probably'
  })
})

test('ensure `console.debug` is defined', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const consoleDebug = () => page.evaluate(() => !!console.debug)
  t.is(await consoleDebug(), true)
})

test('ensure `navigator.vendor` is defined', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const vendor = () => page.evaluate(() => window.navigator.vendor)
  t.is(await vendor(), 'Google Inc.')
})

test('hide webgl vendor', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const webgl = () =>
    page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('webgl')
      const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info')
      return {
        vendor: ctx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      }
    })

  const { vendor, renderer } = await webgl()

  t.true(vendor.includes('Google Inc.'))
  t.true(renderer.includes('SwiftShader'))

  await evasions.webglVendor(page)
  await page.goto(fileUrl)

  t.deepEqual(await webgl(), {
    vendor: 'Intel Inc.',
    renderer: 'Intel(R) Iris(TM) Plus Graphics 640'
  })
})

test('hide `webgl2` vendor', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const webgl2 = () =>
    page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('webgl2')
      const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info')
      return {
        vendor: ctx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      }
    })

  const { vendor, renderer } = await webgl2()

  t.true(vendor.includes('Google Inc.'))
  t.true(renderer.includes('SwiftShader'))

  await evasions.webglVendor(page)
  await page.goto(fileUrl)

  t.deepEqual(await webgl2(), {
    vendor: 'Intel Inc.',
    renderer: 'Intel(R) Iris(TM) Plus Graphics 640'
  })
})

test('ensure broken images have dimensions', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const brokenImage = () =>
    page.evaluate(() => {
      const body = document.body
      const image = document.createElement('img')
      image.src = 'http://iloveponeydotcom32188.jg'
      image.setAttribute('id', 'fakeimage')
      image.onerror = () => Promise.resolve(`${image.width}x${image.height}`)
      body.appendChild(image)
    })

  t.true((await brokenImage()) !== '0x0')
})

test('sanetize stack traces', async t => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  t.teardown(() => page.close())

  const errorStackTrace = () =>
    page.evaluate(() => {
      const error = new Error('oh no!')
      return error.stack.toString()
    })

  t.true((await errorStackTrace()).includes('puppeteer_evaluation_script'))

  await evasions.stackTraces(page)
  await page.goto(fileUrl)

  t.false((await errorStackTrace()).includes('puppeteer_evaluation_script'))
})

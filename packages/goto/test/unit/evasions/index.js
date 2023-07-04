'use strict'

const { getPage } = require('@browserless/test/util/create')({ evasions: false })
const test = require('ava')
const path = require('path')

const evasions = require('../../../src/evasions')

const fileUrl = `file://${path.join(__dirname, '../../fixtures/dummy.html')}`

test('`window.console` is present', async t => {
  const page = await getPage(t)

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

test('`window.outerHeight` is defined', async t => {
  const page = await getPage(t)
  t.true((await page.evaluate(() => window.outerHeight)) > 0)
})

test('`window.outerWidth` is defined', async t => {
  const page = await getPage(t)
  t.true((await page.evaluate(() => window.outerWidth)) > 0)
})

test('`window.navigator.vendor` is synchronized with user-agent', async t => {
  const page = await getPage(t)

  const navigatorVendor = () => page.evaluate('navigator.vendor')

  t.is(await navigatorVendor(), 'Google Inc.')

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5.1 Safari/605.1.15'
  )

  await evasions.navigatorVendor(page)

  await page.goto(fileUrl)

  t.is(await navigatorVendor(), 'Apple Computer, Inc.')

  await page.setUserAgent(
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:109.0) Gecko/20100101 Firefox/114.0'
  )

  await page.goto(fileUrl)
  t.is(await navigatorVendor(), '')
})

test('`navigator.deviceMemory` is present', async t => {
  const page = await getPage(t)
  const deviceMemory = () => page.evaluate('navigator.deviceMemory')
  t.truthy(await deviceMemory())
})

test('`window.navigator.userAgent` is not bot', async t => {
  const page = await getPage(t)
  const userAgent = () => page.evaluate('window.navigator.userAgent')
  t.false(/HeadlessChrome/.test(await userAgent()))
})

test('`window.navigator.webdriver` is present', async t => {
  const page = await getPage(t)
  t.is(await page.evaluate('window.navigator.webdriver'), false)
})

test('`navigator.javaEnabled()` is present', async t => {
  const page = await getPage(t)
  t.is(page.evaluate('navigator.javaEnabled()'), false)
})

test('`navigator.hardwareConcurrency` is present', async t => {
  const page = await getPage(t)
  const n = await page.evaluate('window.navigator.hardwareConcurrency')
  t.true(typeof n === 'number')
  t.true(n !== 0)
})

test('`window.chrome` is defined', async t => {
  const page = await getPage(t)
  const windowChrome = await page.evaluate('window.chrome')
  t.snapshot(windowChrome)
})

test('`navigator.permissions` is defined', async t => {
  const page = await getPage(t)

  const permissionStatusState = () =>
    page.evaluate(async () => {
      const permissionStatus = await navigator.permissions.query({
        name: 'notifications'
      })
      return permissionStatus.state
    })

  t.is(await permissionStatusState(), 'denied')
})

test('`window.navigator.plugins` is defined', async t => {
  const page = await getPage(t)
  t.snapshot(await page.evaluate('window.navigator.plugins'))
})

test('`window.navigator.mimeTypes` are correct', async t => {
  const page = await getPage(t)
  t.snapshot(await page.evaluate('window.navigator.mimeTypes'))
})

test('`navigator.languages` is defined', async t => {
  const page = await getPage(t)
  const languages = () => page.evaluate('window.navigator.languages')
  t.deepEqual(await languages(), ['en-US'])
})

test('media codecs are present', async t => {
  const page = await getPage(t)

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
})

test('hide webgl vendor', async t => {
  const page = await getPage(t)

  const webgl = () =>
    page.evaluate(() => {
      const canvas = document.createElement('canvas')
      const ctx = canvas.getContext('webgl2')
      const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info')
      return {
        vendor: ctx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
        renderer: ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
      }
    })

  const { vendor, renderer } = await webgl()

  t.true(vendor.includes('Google Inc. (Apple)'))
  t.true(renderer.includes('ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'))

  await evasions.webglVendor(page)
  await page.goto(fileUrl)

  t.deepEqual(await webgl(), {
    vendor: 'Intel Inc.',
    renderer: 'Intel(R) Iris(TM) Plus Graphics 640'
  })
})

test('hide `webgl2` vendor', async t => {
  const page = await getPage(t)

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

  t.true(vendor.includes('Google Inc. (Apple)'))
  t.true(renderer.includes('ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'))

  await evasions.webglVendor(page)
  await page.goto(fileUrl)

  t.deepEqual(await webgl2(), {
    vendor: 'Intel Inc.',
    renderer: 'Intel(R) Iris(TM) Plus Graphics 640'
  })
})

test('broken images have dimensions', async t => {
  const page = await getPage(t)

  const dimensions = await page.evaluate(
    () =>
      new Promise(resolve => {
        const body = document.body
        const image = document.createElement('img')
        image.src = 'http://iloveponeydotcom32188.jg'
        image.setAttribute('id', 'fakeimage')
        image.onerror = () => resolve(`${image.width}x${image.height}`)
        body.appendChild(image)
      })
  )

  t.is(dimensions, '16x16')
})

test("error stack traces doesn't reveal implementation details", async t => {
  const page = await getPage(t)

  const errorStackTrace = () =>
    page.evaluate(() => {
      const error = new Error('oh no!')
      return error.stack.toString()
    })

  t.false((await errorStackTrace()).includes('puppeteer_evaluation_script'))
})

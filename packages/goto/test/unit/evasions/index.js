'use strict'

const { getPage } = require('@browserless/test/util')
const isCI = require('is-ci')
const path = require('path')
const test = require('ava')

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

test('`window.navigator.deviceMemory` is present', async t => {
  const page = await getPage(t)
  await page.goto(fileUrl)
  t.is(await page.evaluate('window.navigator.deviceMemory'), 8)
})

test('`window.navigator.userAgent` is not bot', async t => {
  const page = await getPage(t)
  const userAgent = () => page.evaluate('window.navigator.userAgent')
  t.false(/HeadlessChrome/.test(await userAgent()))
  await page.setUserAgent('googlebot')
  t.is(await userAgent(), 'googlebot')
})

test('`window.navigator.webdriver` is present', async t => {
  const page = await getPage(t)
  t.is(await page.evaluate('window.navigator.webdriver'), false)
})

test('`navigator.javaEnabled()` is present', async t => {
  const page = await getPage(t)
  t.is(await page.evaluate('navigator.javaEnabled()'), false)
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

test('webgl vendor is not bot', async t => {
  const page = await getPage(t)

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

  const expected = isCI
    ? {
        vendor: 'Google Inc. (Google)',
        renderer:
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'
      }
    : {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'
      }

  t.deepEqual(await webgl(), expected)
})

test('webgl2 vendor is not bot', async t => {
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

  const expected = isCI
    ? {
        vendor: 'Google Inc. (Google)',
        renderer:
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'
      }
    : {
        vendor: 'Google Inc. (Apple)',
        renderer: 'ANGLE (Apple, Apple M1 Pro, OpenGL 4.1)'
      }

  t.deepEqual(await webgl2(), expected)
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

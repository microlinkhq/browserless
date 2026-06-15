'use strict'

const { getPage } = require('@browserless/test')
const path = require('path')
const test = require('ava')

const isCI = !!process.env.CI

const fileUrl = `file://${path.join(__dirname, '../../fixtures/dummy.html')}`

const readWebGL = (page, type) =>
  page.evaluate(type => {
    const ctx = document.createElement('canvas').getContext(type)
    const debugInfo = ctx.getExtension('WEBGL_debug_renderer_info')
    return {
      vendor: ctx.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL),
      renderer: ctx.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)
    }
  }, type)

test('`window.Notification` is not defined', async t => {
  const page = await getPage(t)
  t.is((await page.evaluate('typeof window.Notification'), undefined))
})

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
  t.true((await page.evaluate('window.navigator.deviceMemory')) > 0)
})

test('`window.navigator.webdriver` is false', async t => {
  const page = await getPage(t)
  t.is(await page.evaluate('window.navigator.webdriver'), false)
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

  t.deepEqual(await videoCodecs(), { ogg: '', h264: 'probably', webm: 'probably' })

  t.deepEqual(await audioCodecs(), {
    ogg: 'probably',
    mp3: 'probably',
    wav: 'probably',
    m4a: 'maybe',
    aac: 'probably'
  })
})

test('webgl vendor is not bot', async t => {
  const page = await getPage(t)
  const { vendor } = await readWebGL(page, 'webgl')
  t.true(vendor.startsWith('Google Inc.'))
})

test('webgl2 vendor is not bot', async t => {
  const page = await getPage(t)
  const { vendor } = await readWebGL(page, 'webgl2')
  t.true(vendor.startsWith('Google Inc.'))
})

test('webgl renderer goes through ANGLE (Mesa llvmpipe on CI)', async t => {
  const page = await getPage(t)

  for (const type of ['webgl', 'webgl2']) {
    const { vendor, renderer } = await readWebGL(page, type)

    // Portable: WebGL must go through ANGLE, never a SwiftShader / 2D fallback.
    t.true(vendor.startsWith('Google Inc.'), `${type}: ${vendor}`)
    t.true(renderer.startsWith('ANGLE ('), `${type}: ${renderer}`)
    t.false(renderer.includes('SwiftShader'), `${type}: ${renderer}`)

    // --use-angle=gl binds to the host's system GL: Mesa llvmpipe on the
    // GPU-less Linux target (CI under Xvfb), but native GL on macOS/Windows or
    // hardware-accelerated hosts. Pin the whole llvmpipe string only on CI; the
    // `LLVM x.y.z, N bits` token tracks the runner's Mesa/LLVM build so it is
    // normalized out, and everything else is compared exactly.
    if (isCI) {
      const expected = 'ANGLE (Mesa, llvmpipe (LLVM <llvm>), OpenGL 4.5)'
      const normalized = renderer.replace(/LLVM [\d.]+,? \d+ bits/, 'LLVM <llvm>')
      t.is(vendor, 'Google Inc. (Mesa)', type)
      t.is(normalized, expected, `${type}: ${renderer}`)
    }
  }
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

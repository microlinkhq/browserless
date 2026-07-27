'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const createScreenshot = require('..')
const test = require('ava')

const isCI = !!process.env.CI

test('graphics features', async t => {
  const browserless = await getBrowserContext(t)

  // Assert real WebGL capability rather than the chrome://gpu feature-status
  // strings: those vary wildly by Mesa/LLVM version and host (e.g. CI labels
  // WebGL "Disabled" while it still renders through ANGLE), so they don't
  // reflect actual capability. A live getContext + ANGLE renderer does.
  const getWebGL = browserless.withPage(page => async () => {
    const result = await page.evaluate(() => {
      const ctx = document.createElement('canvas').getContext('webgl')
      if (!ctx) return null
      const dbg = ctx.getExtension('WEBGL_debug_renderer_info')
      return {
        vendor: ctx.getParameter(dbg.UNMASKED_VENDOR_WEBGL),
        renderer: ctx.getParameter(dbg.UNMASKED_RENDERER_WEBGL)
      }
    })
    await page.close()
    return result
  })

  const webgl = await getWebGL()
  t.truthy(webgl)
  t.true(webgl.vendor.startsWith('Google Inc.'))
  // Portable: WebGL must go through ANGLE, never a silent SwiftShader / 2D
  // fallback. The message surfaces the real renderer if the backend changes.
  t.true(webgl.renderer.startsWith('ANGLE ('), webgl.renderer)
  t.false(webgl.renderer.includes('SwiftShader'), webgl.renderer)
  // --use-angle=gl resolves to Mesa llvmpipe only on the GPU-less Linux target
  // (CI under Xvfb); on macOS/Windows/hardware GL the backend differs but is
  // still valid, so pin llvmpipe only on CI.
  if (isCI) t.true(webgl.renderer.includes('llvmpipe'), webgl.renderer)
})

test('dialog listener is cleaned up between screenshot calls on same page', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body><h1>ok</h1></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    const screenshot = createScreenshot({ goto })(page)
    const listenersBefore = page.listenerCount('dialog')

    await screenshot(url, { waitUntil: 'load', adblock: false, timeout: 2000 })
    const listenersAfterFirst = page.listenerCount('dialog')

    await screenshot(url, { waitUntil: 'load', adblock: false, timeout: 2000 })
    const listenersAfterSecond = page.listenerCount('dialog')

    return { listenersBefore, listenersAfterFirst, listenersAfterSecond }
  })

  const { listenersBefore, listenersAfterFirst, listenersAfterSecond } = await run()

  t.is(listenersAfterFirst, listenersBefore)
  t.is(listenersAfterSecond, listenersBefore)
})

// `page.screenshot` only accepts `quality` for the lossy encoders and throws for
// everything else — including the png it silently defaults to. A caller that
// asks for quality without also asking for jpeg/webp lost the whole capture:
// `Error: png screenshots do not support 'quality'.`, 32 of 766 unexpected
// errors over a week in microlink production.
const { withValidQuality } = createScreenshot

test('withValidQuality keeps quality for the lossy encoders', t => {
  t.is(withValidQuality({ type: 'jpeg', quality: 80 }).quality, 80)
  t.is(withValidQuality({ type: 'webp', quality: 80 }).quality, 80)
})

test('withValidQuality drops quality for anything else', t => {
  t.false('quality' in withValidQuality({ quality: 80 }), 'no type means png')
  t.false('quality' in withValidQuality({ type: 'png', quality: 80 }))
})

// `page.screenshot` settles the type from the `path` extension when `type` is
// absent, and validates `quality` after doing so. Reading only `type` here would
// throw away a quality the capture would have honoured.
test('withValidQuality resolves the type from the path like page.screenshot does', t => {
  t.is(withValidQuality({ path: 'out.jpg', quality: 80 }).quality, 80)
  t.is(withValidQuality({ path: 'out.JPEG', quality: 80 }).quality, 80)
  t.is(withValidQuality({ path: 'out.webp', quality: 80 }).quality, 80)
  t.false('quality' in withValidQuality({ path: 'out.png', quality: 80 }))
  t.is(withValidQuality({ type: 'jpeg', path: 'out.png', quality: 80 }).quality, 80)
})

test('withValidQuality leaves options without quality untouched', t => {
  const opts = { type: 'png', fullPage: true }
  t.is(withValidQuality(opts), opts, 'same reference — nothing to normalise')
})

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])

test('a quality asked for without a lossy type still captures', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body style="background:#c84"><h1>ok</h1></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    const screenshot = createScreenshot({ goto })(page)
    return {
      png: await screenshot(url, { waitUntil: 'load', adblock: false, timeout: 5000, quality: 80 }),
      jpeg: await screenshot(url, {
        waitUntil: 'load',
        adblock: false,
        timeout: 5000,
        type: 'jpeg',
        quality: 80
      })
    }
  })

  const { png, jpeg } = await run()
  t.deepEqual(png.subarray(0, 4), PNG_MAGIC, 'the ignored quality still yields a png')
  t.deepEqual(jpeg.subarray(0, 3), JPEG_MAGIC, 'an explicit jpeg still honours quality')
})

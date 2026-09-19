'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const { readFile, rm } = require('node:fs/promises')
const { randomUUID } = require('node:crypto')
const createScreenshot = require('..')
const path = require('node:path')
const os = require('node:os')
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

// `encoding: 'base64'` makes puppeteer return a string, and the blank-page
// check under `waitUntil: 'auto'` handed it to sharp as if it were image bytes:
// "Input buffer contains unsupported image format".
test('`encoding: base64` returns the capture as base64', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<html><body style="background:#c84"><h1>ok</h1></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    const screenshot = createScreenshot({ goto })(page)
    const opts = { adblock: false, timeout: 10000, type: 'jpeg', encoding: 'base64' }
    return {
      auto: await screenshot(url, opts),
      load: await screenshot(url, { ...opts, waitUntil: 'load' }),
      fullPage: await screenshot(url, { ...opts, fullPage: true }),
      overlay: await screenshot(url, { ...opts, overlay: { background: '#fff' } }),
      binary: await screenshot(url, { ...opts, encoding: 'binary' })
    }
  })

  const { binary, overlay, ...captures } = await run()
  for (const [name, value] of Object.entries(captures)) {
    t.is(typeof value, 'string', name)
    t.deepEqual(Buffer.from(value, 'base64').subarray(0, 3), JPEG_MAGIC, name)
  }
  t.is(typeof overlay, 'string', 'overlay')
  t.deepEqual(Buffer.from(overlay, 'base64').subarray(0, 4), PNG_MAGIC, 'overlay composites a png')
  t.deepEqual(binary.subarray(0, 3), JPEG_MAGIC, 'binary stays binary')
})

// puppeteer settles the encoder from the `path` extension when `type` is absent,
// and validates `quality` only after that — so `{ path: 'out.jpg', quality }` is
// a capture it accepts. A guard that reads `type` alone would strip the quality
// and silently hand back the encoder default instead.
test('a quality reaches the encoder puppeteer inferred from the path', async t => {
  const browserless = await getBrowserContext(t)

  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(
      '<html><body style="margin:0;background:linear-gradient(45deg,#c84,#26c,#4a8,#a2c)"><h1>ok</h1></body></html>'
    )
  })

  const capture = quality => {
    const filepath = path.join(os.tmpdir(), `quality-${randomUUID()}.jpg`)
    t.teardown(() => rm(filepath, { force: true }))
    return browserless.withPage((page, goto) => async () => {
      await createScreenshot({ goto })(page)(url, {
        waitUntil: 'load',
        adblock: false,
        timeout: 5000,
        path: filepath,
        quality
      })
      return (await readFile(filepath)).length
    })()
  }

  const [low, high] = [await capture(1), await capture(100)]
  t.true(low > 0 && high > 0, 'both captures produced a file')
  t.true(low < high, `quality reached the encoder (${low} bytes at q1 vs ${high} at q100)`)
})

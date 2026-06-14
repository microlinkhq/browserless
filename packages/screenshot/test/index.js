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

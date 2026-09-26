'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const sharp = require('sharp')
const test = require('ava')

const createScreenshot = require('..')

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

// 8×8 #0c0. Stretched across the hero, so a decoded capture is green there.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR42mNgOMOAHQ0tCQDt5TMBdM575gAAAABJRU5ErkJggg==',
  'base64'
)

const page = ({ arm }) => `<!doctype html>
<html>
  <body style="margin:0;background:#888">
    <img id="hero" width="320" height="200" data-src="/pixel.png" style="display:block;background:#ccc">
    <script>
      const img = document.getElementById('hero')
      const start = () => {
        img.onload = () => { document.body.style.background = '#0c0' }
        img.src = img.getAttribute('data-src')
      }
      ${arm}
    </script>
  </body>
</html>`

const pixelAt = async (png, x, y) => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const offset = (y * info.width + x) * info.channels
  return [data[offset], data[offset + 1], data[offset + 2]]
}

const heroPixel = png => pixelAt(png, 12, 12)

const isGreen = ([r, g, b]) => r < 40 && g > 150 && b < 40

const isRed = ([r, g, b]) => r > 200 && g < 40 && b < 40

const serve = (t, html) =>
  runServer(t, ({ req, res }) => {
    if (req.url === '/pixel.png') {
      res.setHeader('content-type', 'image/png')
      res.end(PIXEL)
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })

test('waitUntil auto waits for an in-viewport lazy image', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    page({ arm: "window.addEventListener('scroll', start, { once: true })" })
  )

  const started = Date.now()
  const png = await browserless.withPage(
    (browserPage, goto) => async () =>
      createScreenshot({ goto })(browserPage)(url, { adblock: false, timeout: 33000 })
  )()

  t.deepEqual([...png.subarray(0, 4)], [...PNG_MAGIC])
  t.true(isGreen(await heroPixel(png)), 'the capture waited until the hero decoded')
  t.true(Date.now() - started < 20000, 'the wait stayed inside the action budget')
})

test('waitUntil auto still captures when a lazy image never arrives', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, page({ arm: '' }))

  const started = Date.now()
  const png = await browserless.withPage(
    (browserPage, goto) => async () =>
      createScreenshot({ goto })(browserPage)(url, { adblock: false, timeout: 22000 })
  )()
  const elapsed = Date.now() - started

  t.deepEqual([...png.subarray(0, 4)], [...PNG_MAGIC])
  t.false(isGreen(await heroPixel(png)))
  t.true(elapsed < 15000, `gave up inside the action budget (${elapsed}ms)`)
})

test('a hidden lazy image does not hold the capture', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    page({ arm: '' }).replace('style="display:block;background:#ccc"', 'style="visibility:hidden"')
  )

  const started = Date.now()
  const png = await browserless.withPage(
    (browserPage, goto) => async () =>
      createScreenshot({ goto })(browserPage)(url, { adblock: false, timeout: 55000 })
  )()
  const elapsed = Date.now() - started

  t.deepEqual([...png.subarray(0, 4)], [...PNG_MAGIC])
  t.false(isGreen(await heroPixel(png)))
  // Action budget for this timeout is 5s. A hidden slide must not spend it.
  t.true(elapsed < 4000, `hidden image held the shot for ${elapsed}ms`)
})

test('waitUntil auto restores the viewport when scroll-behavior is smooth', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    `<!doctype html>
<html style="scroll-behavior:smooth">
  <body style="margin:0;background:#888">
    <div style="height:64px;background:#f00"></div>
    <img id="hero" width="320" height="200" data-src="/pixel.png" style="display:block">
    <div style="height:4000px"></div>
    <script>
      const img = document.getElementById('hero')
      window.addEventListener('scroll', () => {
        img.src = img.getAttribute('data-src')
      }, { once: true })
    </script>
  </body>
</html>`
  )

  const png = await browserless.withPage(
    (browserPage, goto) => async () =>
      createScreenshot({ goto })(browserPage)(url, { adblock: false, timeout: 33000 })
  )()

  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const rgbAt = y => {
    const offset = (y * info.width + 12) * info.channels
    return [data[offset], data[offset + 1], data[offset + 2]]
  }
  let belowBar = [0, 0, 0]
  for (let y = 0; y < info.height; y++) {
    const rgb = rgbAt(y)
    if (!isRed(rgb)) {
      belowBar = rgb
      break
    }
  }

  t.deepEqual([...png.subarray(0, 4)], [...PNG_MAGIC])
  t.true(isRed(rgbAt(0)), 'the capture is back at the top')
  t.true(isGreen(belowBar), 'the hero loaded after the nudge')
})

test('an explicit waitUntil does not wait on a lazy image', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(
    t,
    page({ arm: "window.addEventListener('scroll', start, { once: true })" })
  )

  const started = Date.now()
  const png = await browserless.withPage(
    (browserPage, goto) => async () =>
      createScreenshot({ goto })(browserPage)(url, {
        adblock: false,
        timeout: 10000,
        waitUntil: 'load'
      })
  )()

  t.deepEqual([...png.subarray(0, 4)], [...PNG_MAGIC])
  t.false(isGreen(await heroPixel(png)))
  t.true(Date.now() - started < 8000)
})

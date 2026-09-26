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

const heroPixel = async png => {
  const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
  const offset = (12 * info.width + 12) * info.channels
  return [data[offset], data[offset + 1], data[offset + 2]]
}

const isGreen = ([r, g, b]) => r < 40 && g > 150 && b < 40

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

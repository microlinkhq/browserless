'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const sharp = require('sharp')
const { default: test } = require('ava')

const createScreenshot = require('..')

const TIMEOUT = 33000
const STEP_BUDGET = TIMEOUT / 11

const noisePng = () =>
  sharp({
    create: {
      width: 600,
      height: 600,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 60 }
    }
  })
    .png()
    .toBuffer()

const html = `<!doctype html>
<html>
  <body style="margin:0;background:#0c0">
    <h1>Ready</h1>
    <div id="menu" style="display:none"></div>
    <script>
      window.addEventListener('load', () => {
        document.getElementById('menu').innerHTML = '<img src="/stalled.png" alt="">'
      })
    </script>
  </body>
</html>`

test('an image that is not rendered and never finishes loading does not hold the capture', async t => {
  const stalled = await noisePng()
  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/stalled.png') {
      res.setHeader('content-type', 'image/png')
      res.setHeader('content-length', String(stalled.length))
      res.write(stalled.subarray(0, Math.floor(stalled.length / 2)))
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })

  const browserless = await getBrowserContext(t)
  const started = Date.now()
  const png = await browserless.withPage(
    (page, goto) => async () =>
      createScreenshot({ goto })(page)(url, { adblock: false, timeout: TIMEOUT })
  )()
  const duration = Date.now() - started

  t.true(png.length > 0)
  t.true(duration < STEP_BUDGET, `took ${duration}ms, the step budget is ${STEP_BUDGET}ms`)
})

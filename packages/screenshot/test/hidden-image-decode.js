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
      width: 200,
      height: 80,
      channels: 3,
      noise: { type: 'gaussian', mean: 128, sigma: 60 }
    }
  })
    .png()
    .toBuffer()

// 24px stays under the 32px pending threshold, so only decode() can hold the shot.
const page = (markup, add) => `<!doctype html>
<html>
  <body style="margin:0;background:#0c0">
    <h1>Ready</h1>
    ${markup}
    <script>
      window.addEventListener('load', () => {
        const add = (parent, attrs) => {
          const src = attrs.indexOf('src=') === 0 ? '' : 'src="/stalled.png" '
          parent.insertAdjacentHTML('beforeend', '<img alt="" ' + src + attrs + '>')
        }
        ${add}
      })
    </script>
  </body>
</html>`

const hidden = page(
  `<div id="menu" style="display:none"></div>
    <div id="slide" style="visibility:hidden"></div>
    <div id="fold" style="content-visibility:hidden"></div>`,
  `add(document.getElementById('menu'), '')
        add(document.body, 'style="display:block;width:0;height:24px"')
        add(document.body, 'style="display:block;width:24px;height:0"')
        add(document.body, 'width="24" height="24" style="display:block;visibility:hidden"')
        add(document.body, 'width="24" height="24" style="display:block;content-visibility:hidden"')
        add(document.body, 'width="200" height="80" style="display:block;visibility:hidden"')
        add(document.body, 'width="200" height="80" style="display:block;content-visibility:hidden"')
        add(document.body, 'src="/quiet.png" width="200" height="80" style="display:block;content-visibility:hidden"')
        add(document.getElementById('slide'), 'width="24" height="24" style="display:block"')
        add(document.getElementById('fold'), 'width="24" height="24" style="display:block"')`
)

const shown = page(
  '<div id="shown"></div>',
  'add(document.getElementById(\'shown\'), \'width="24" height="24" style="display:block"\')'
)

const capture = async (t, html) => {
  const stalled = await noisePng()
  const url = await runServer(t, ({ req, res }) => {
    if (req.url === '/stalled.png' || req.url === '/quiet.png') {
      res.setHeader('content-type', 'image/png')
      res.setHeader('content-length', String(stalled.length))
      if (req.url === '/quiet.png') return
      res.write(stalled.subarray(0, Math.floor(stalled.length / 2)))
      return
    }
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })
  const browserless = await getBrowserContext(t)
  const started = Date.now()
  const png = await browserless.withPage(
    (browserPage, goto) => async () =>
      createScreenshot({ goto })(browserPage)(url, { adblock: false, timeout: TIMEOUT })
  )()
  return { png, duration: Date.now() - started }
}

test('an image that draws nothing and never finishes loading does not hold the capture', async t => {
  const { png, duration } = await capture(t, hidden)
  t.true(png.length > 0)
  t.true(duration < STEP_BUDGET, `took ${duration}ms, the step budget is ${STEP_BUDGET}ms`)
})

test('a rendered image that never finishes loading is still decoded', async t => {
  const { png, duration } = await capture(t, shown)
  t.true(png.length > 0)
  t.true(
    duration >= STEP_BUDGET,
    `took ${duration}ms, decode should spend the step budget of ${STEP_BUDGET}ms`
  )
})

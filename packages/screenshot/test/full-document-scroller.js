'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const { default: test } = require('ava')

const { prepareFullDocument } = require('../src/prepare-full-document')

const TIMEOUT = 30000
const SCROLLER_DELAY_MS = 2200

const lateScroller = `<!doctype html>
<html>
  <body style="margin:0;height:100vh;overflow:hidden">
    <script>
      setTimeout(() => {
        const scroller = document.createElement('div')
        scroller.id = 'scroller'
        scroller.style.cssText = 'height:100vh;overflow-y:auto'
        scroller.innerHTML = '<div style="height:6000px">Slides</div>'
        document.body.appendChild(scroller)
      }, ${SCROLLER_DELAY_MS})
    </script>
  </body>
</html>`

const open = async (t, html) => {
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })
  const browserless = await getBrowserContext(t)
  const page = await browserless.page()
  t.teardown(() => page.close())
  await page.goto(url, { waitUntil: 'load' })
  return { page, goto: browserless.goto }
}

test('a scroller that appears after the overflow wait gave up is still expanded for print', async t => {
  const { page, goto } = await open(t, lateScroller)

  const { expanded } = await prepareFullDocument(page, { goto, timeout: TIMEOUT })

  t.true(expanded)
  const overflow = await page.$eval('#scroller', el => window.getComputedStyle(el).overflowY)
  t.is(overflow, 'visible')
})

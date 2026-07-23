'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const test = require('ava')

const createPdf = require('..')

// A shell that renders nothing until its data arrives, laid out the way that
// defeats every settle signal the readiness gate has: the HTML is complete, it
// ships no images, and it scrolls an inner pane so the document height is fixed
// at the viewport and can never change. Before the content wait, `prepare`
// returned in ~450ms and printed the placeholders.
const shellHtml =
  delay => `<!doctype html><html><body style="margin:0;height:100vh;overflow:hidden">
<div id="pane" style="position:absolute;inset:0;overflow:auto">
  <div id="skeleton" style="height:900px;background:#e5e7eb"></div>
</div>
<script>
  setTimeout(() => {
    document.getElementById('pane').innerHTML =
      '<table><tr><td>real content that only exists after the data lands</td></tr></table>'
  }, ${delay})
</script></body></html>`

const prepared = (browserless, body) => async timeout => {
  const url = await runServer({ teardown: () => {} }, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(body)
  })
  return browserless.withPage((page, goto) => async () => {
    const { prepare } = createPdf({ goto })
    await prepare(page, url, { timeout })
    const content = await page.evaluate(() => ({
      hasTable: !!document.querySelector('table'),
      text: (document.body.innerText || '').trim().length,
      documentHeight: document.body.scrollHeight
    }))
    await page.close()
    return content
  })()
}

test('waits for a shell to render before printing it', async t => {
  const browserless = await getBrowserContext(t)
  const content = await prepared(browserless, shellHtml(1200))(30000)

  t.true(
    content.documentHeight < 1500,
    'the document height never moves, so it cannot signal that content arrived'
  )
  t.true(content.hasTable, 'prepare returned only once the real content existed')
  t.true(content.text > 0)
})

// The wait is bounded: a document that never renders anything must not hold the
// render open, it just prints whatever is there once the budget is spent.
test('gives up on a shell that never renders, rather than hanging', async t => {
  const browserless = await getBrowserContext(t)
  const startedAt = Date.now()
  const content = await prepared(browserless, shellHtml(600000))(4000)
  const elapsed = Date.now() - startedAt

  t.false(content.hasTable, 'nothing ever rendered')
  t.true(elapsed < 20000, `bounded by the budget, took ${elapsed}ms`)
})

// An ordinary page already carries content on the first check, so it must not
// pay anything for the wait.
test('does not delay a page that already has content', async t => {
  const browserless = await getBrowserContext(t)
  const startedAt = Date.now()
  const content = await prepared(
    browserless,
    '<!doctype html><html><body><h1>ready immediately</h1><p>with text</p></body></html>'
  )(30000)
  const elapsed = Date.now() - startedAt

  t.true(content.text > 0)
  t.true(elapsed < 10000, `no meaningful wait, took ${elapsed}ms`)
})

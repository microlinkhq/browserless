'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const test = require('ava')

const { scrollToLoadContent } = require('..')

// A page whose scroller is an inner `overflow:auto` pane, not the document:
// `document.body.scrollHeight` stays at the viewport no matter how long the
// content is, which is the layout that made `window.scrollBy` a no-op. Each
// block swaps its placeholder for real content the first time it intersects.
const innerPaneHtml =
  blocks => `<!doctype html><html><body style="margin:0;height:100vh;overflow:hidden">
<div id="pane" style="position:absolute;inset:0;overflow:auto">
  ${Array.from(
    { length: blocks },
    (_, i) => `<div class="block" data-i="${i}" style="height:900px">placeholder</div>`
  ).join('')}
</div>
<script>
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.textContent = 'loaded-' + entry.target.dataset.i
      entry.target.dataset.loaded = '1'
      io.unobserve(entry.target)
    }
  }, { root: document.getElementById('pane') })
  document.querySelectorAll('.block').forEach(el => io.observe(el))
</script></body></html>`

const loadedCount = page =>
  page.evaluate(() => ({
    total: document.querySelectorAll('.block').length,
    loaded: document.querySelectorAll('.block[data-loaded="1"]').length,
    documentHeight: document.body.scrollHeight
  }))

test('reveals content gated behind an inner scroll pane', async t => {
  const BLOCKS = 12
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(innerPaneHtml(BLOCKS))
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load' })
    const before = await loadedCount(page)
    await scrollToLoadContent(page, 10000)
    const after = await loadedCount(page)
    await page.close()
    return { before, after }
  })

  const { before, after } = await run()

  t.true(
    before.documentHeight < 1500,
    'the document itself never grows, so walking `window` alone reveals nothing'
  )
  t.true(before.loaded < BLOCKS, 'content below the fold starts unrevealed')
  t.is(after.loaded, BLOCKS, 'every block is revealed after the walk')
})

// Native lazy images are the pattern screenshots already relied on, so the walk
// must keep serving them: every image is requested and decoded, not merely
// scrolled past.
test('loads native lazy images down the document', async t => {
  const IMAGES = 20
  const PNG = Buffer.from(
    '89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
      '1f15c4890000000d4944415478da6364f8cf000000030101007ca1d027' +
      '0000000049454e44ae426082',
    'hex'
  )
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ req, res }) => {
    if (req.url.startsWith('/img/')) {
      return setTimeout(() => {
        res.setHeader('content-type', 'image/png')
        res.end(PNG)
      }, 50)
    }
    res.setHeader('content-type', 'text/html')
    res.end(
      `<!doctype html><html><body style="margin:0">${Array.from(
        { length: IMAGES },
        (_, i) =>
          `<div style="height:900px"><img loading="lazy" src="/img/${i}.png" width="300" height="300"></div>`
      ).join('')}</body></html>`
    )
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load' })
    await scrollToLoadContent(page, 10000)
    const result = await page.evaluate(() => ({
      total: document.images.length,
      decoded: [...document.images].filter(img => img.complete && img.naturalWidth > 0).length
    }))
    await page.close()
    return result
  })

  const { total, decoded } = await run()
  t.is(total, IMAGES)
  t.is(decoded, IMAGES, 'every lazy image is requested and decoded')
})

// The timeout is a backstop for a document that keeps growing, not the pace. A
// page with nothing to scroll must not be charged for it — pausing between steps
// used to spend the whole allowance on a one-screen document.
test('returns promptly when there is nothing to scroll', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end('<!doctype html><html><body style="margin:0"><p>short</p></body></html>')
  })

  const run = browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load' })
    const startedAt = Date.now()
    await scrollToLoadContent(page, 10000)
    const elapsed = Date.now() - startedAt
    await page.close()
    return elapsed
  })

  const elapsed = await run()
  t.true(elapsed < 5000, `expected well under the 10s backstop, took ${elapsed}ms`)
})

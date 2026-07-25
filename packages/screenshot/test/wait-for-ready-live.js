'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const test = require('ava')

const { waitForReady } = require('..')

// Exercises the real in-page `paintSignals()` against a live DOM — the part the
// unit tests can't reach, since `getBoundingClientRect`/`checkVisibility` only
// mean anything in a browser. A 1×1 transparent PNG stands in for real imagery;
// what distinguishes "painted" is the rendered box, viewport, and visibility.
const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'
// Valid data-URI syntax, but the payload ("hello") isn't a decodable image, so
// the <img> finishes loading with an error: complete, naturalWidth 0.
const BROKEN = 'data:image/png;base64,aGVsbG8='

const html = body =>
  `<!doctype html><html><body style="margin:0;height:3000px">${body}</body></html>`

const ready = (browserless, body) => {
  const serve = t =>
    runServer(t, ({ res }) => {
      res.setHeader('content-type', 'text/html')
      res.end(html(body))
    })
  return async t => {
    const url = await serve(t)
    return browserless.withPage((page, goto) => async () => {
      await goto(page, { url, waitUntil: 'load', adblock: false, timeout: 5000 })
      const result = await waitForReady(page, { timeout: 5000, quietMs: 100, poll: 50 })
      await page.close()
      return result
    })()
  }
}

test('painted: a visibly rendered image in a tall document', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(browserless, `<img src="${PIXEL}" width="300" height="300">`)(t)
  t.false(r.timedOut)
  t.is(r.decoded, 1)
  t.true(r.painted >= 1)
  t.true(r.viewport > 0)
  t.true(r.height > r.viewport)
})

test('tracking pixel: decoded but not painted', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(browserless, `<img src="${PIXEL}" width="1" height="1">`)(t)
  t.false(r.timedOut)
  t.is(r.decoded, 1)
  t.is(r.painted, 0)
})

test('hidden image: decoded but not painted', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    `<img src="${PIXEL}" width="300" height="300" style="visibility:hidden">`
  )(t)
  t.false(r.timedOut)
  t.is(r.decoded, 1)
  t.is(r.painted, 0)
})

test('imageless page: no images, nothing painted', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(browserless, '<h1>ok</h1>')(t)
  t.false(r.timedOut)
  t.is(r.images, 0)
  t.is(r.painted, 0)
})

test('broken image: counts as settled (decoded) so it never stalls the gate', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(browserless, `<img src="${BROKEN}" width="300" height="300">`)(t)
  t.false(r.timedOut)
  t.is(r.decoded, 1)
  t.is(r.painted, 0)
})

test('text: 200+ visible characters in the viewport count as painted text', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(browserless, `<p>${'lorem ipsum '.repeat(20)}</p>`)(t)
  t.false(r.timedOut)
  t.true(r.text >= 200)
  t.true(r.fonts)
  t.false(r.covered)
})

test('covered: an opaque fixed overlay hides painted text', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    `<p>${'lorem ipsum '.repeat(20)}</p>` +
      '<div style="position:fixed;inset:0;background:#fff;z-index:9999"></div>'
  )(t)
  t.false(r.timedOut)
  t.true(r.text >= 200)
  t.true(r.covered)
})

test('covered: an opaque fixed overlay hides a painted image', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    `<img src="${PIXEL}" width="300" height="300">` +
      '<div style="position:fixed;inset:0;background:#fff;z-index:9999"></div>'
  )(t)
  t.false(r.timedOut)
  t.true(r.painted >= 1)
  t.true(r.covered)
})

test('covered: a pointer-events:none overlay is caught by the root-level scan', async t => {
  const browserless = await getBrowserContext(t)
  // `elementFromPoint` skips `pointer-events: none` elements, so only the
  // root-level layer scan can see this one (how fading loaders are styled).
  const r = await ready(
    browserless,
    `<p>${'lorem ipsum '.repeat(20)}</p>` +
      '<div style="position:fixed;inset:0;background:#fff;z-index:9999;pointer-events:none"></div>'
  )(t)
  t.false(r.timedOut)
  t.true(r.text >= 200)
  t.true(r.covered)
})

test('not covered: a transparent full-viewport click-catcher', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    `<p>${'lorem ipsum '.repeat(20)}</p>` +
      '<div style="position:fixed;inset:0;z-index:9999"></div>'
  )(t)
  t.false(r.timedOut)
  t.true(r.text >= 200)
  t.false(r.covered)
})

test('not covered: a fixed opaque app shell that contains the content', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    '<div style="position:fixed;inset:0;background:#fff;overflow:auto">' +
      `<p>${'lorem ipsum '.repeat(20)}</p></div>`
  )(t)
  t.false(r.timedOut)
  t.true(r.text >= 200)
  t.false(r.covered)
})

test('white-on-white text does not count toward the text signal', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(browserless, `<p style="color:#fff">${'lorem ipsum '.repeat(20)}</p>`)(t)
  t.false(r.timedOut)
  t.is(r.text, 0)
})

test('hidden text does not count toward the text signal', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    `<p style="visibility:hidden">${'lorem ipsum '.repeat(20)}</p>`
  )(t)
  t.false(r.timedOut)
  t.is(r.text, 0)
})

test('below-viewport text does not count toward the text signal', async t => {
  const browserless = await getBrowserContext(t)
  const r = await ready(
    browserless,
    `<p style="position:absolute;top:5000px">${'lorem ipsum '.repeat(20)}</p>`
  )(t)
  t.false(r.timedOut)
  t.is(r.text, 0)
})

test('no document root: paintSignals degrades to zeros instead of failing the capture', async t => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(html('<h1>ok</h1>'))
  })
  const r = await browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false, timeout: 5000 })
    // The production failure state behind #845: a mid-parse or detached
    // document exposes neither `body` nor `documentElement`. Every paintSignals
    // dereference of the root must survive it — `createTreeWalker` threw on
    // the null walker root, and `scrollHeight`/`clientWidth` sit one null
    // dereference away from the same capture-killing rethrow.
    await page.evaluate(() => document.removeChild(document.documentElement))
    const result = await waitForReady(page, { timeout: 5000, quietMs: 100, poll: 50 })
    await page.close()
    return result
  })()
  t.false(r.timedOut)
  t.is(r.height, 0)
  t.is(r.text, 0)
  t.is(r.painted, 0)
})

test('below-fold lazy image: excluded from the settle gate so it cannot stall it', async t => {
  const browserless = await getBrowserContext(t)
  // 20000px down is beyond every lazy-load fetch threshold Chromium uses, so
  // the image never starts loading (`complete` stays false forever). The src
  // is a real HTTP URL: had the exclusion failed and the fetch happened, the
  // server's HTML reply would error the <img> into `complete`, showing up as
  // `images: 2, decoded: 2` instead of a timeout.
  const r = await ready(
    browserless,
    `<img src="${PIXEL}" width="300" height="300">` +
      '<img src="lazy.png" loading="lazy" width="300" height="300" style="position:absolute;top:20000px">'
  )(t)
  t.false(r.timedOut)
  t.is(r.images, 1)
  t.is(r.decoded, 1)
})

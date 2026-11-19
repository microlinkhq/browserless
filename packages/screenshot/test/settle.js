'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const { default: test } = require('ava')
const sharp = require('sharp')

const createScreenshot = require('..')
const createSettle = require('../src/settle')
const { symptomsOf, isSettled, SETTLE_CAP_MS } = require('../src/settle')

const READY = {
  coverage: 0.8,
  pendingImages: 0,
  loadingVideos: 0,
  finiteAnimations: 0,
  skeletons: 0,
  shifting: false,
  fadingChanged: false,
  pendingReveals: 0,
  unsizedCanvases: 0,
  canvasUnsettled: false,
  sinceMutation: 1000
}

const SLOW_ASSET_MS = 400
const PIXEL = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')

const serve = (t, html) =>
  runServer(t, async ({ req, res }) => {
    if (req.url === '/slow.gif') {
      await new Promise(resolve => setTimeout(resolve, SLOW_ASSET_MS))
      res.setHeader('content-type', 'image/gif')
      return res.end(PIXEL)
    }
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })

const settleOn = async (t, html, { timeout = 10000, beforeWait = async () => {} } = {}) => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, html)
  const page = await browserless.page()
  t.teardown(() => page.close())
  await page.setViewport({ width: 1280, height: 800 })
  const settle = createSettle(page)
  try {
    await page.goto(url, { waitUntil: 'load' })
    await beforeWait(page)
    return await settle.wait({ timeout })
  } finally {
    await settle.stop()
  }
}

const centerPixel = async image => {
  const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true })
  const offset =
    (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels
  return [data[offset], data[offset + 1], data[offset + 2]]
}

const shoot = async (t, html, opts) => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, html)
  return browserless.withPage((page, goto) => async () => {
    await page.setViewport({ width: 1280, height: 800 })
    return createScreenshot({ goto })(page)(url, {
      adblock: false,
      timeout: 20000,
      type: 'png',
      ...opts
    })
  })()
}

const STATIC_PAGE = `<!doctype html><body style="margin:0;font:32px sans-serif">
${Array.from(
  { length: 40 },
  (_, index) =>
    `<p>Paragraph ${index} with enough words to fill the line across the viewport width.</p>`
).join('')}
</body>`

const FRAME_GATED_HERO = `<!doctype html><body style="margin:0;background:#000;height:800px">
<script>
  let frames = 0
  const tick = () => {
    if (++frames < 30) return requestAnimationFrame(tick)
    const hero = document.createElement('div')
    hero.style.cssText = 'position:fixed;inset:0;background:rgb(220,30,30)'
    hero.textContent = 'Hero'
    document.body.appendChild(hero)
  }
  requestAnimationFrame(tick)
</script></body>`

const SCRIPTED_FADE = `<!doctype html><body style="margin:0;background:#fff">
<h1 id="title" style="visibility:hidden;margin:0;height:800px;background:rgb(20,20,200);color:#fff;font-size:120px">Headline</h1>
<p style="font-size:40px">${'Some supporting copy that stays visible. '.repeat(30)}</p>
<script>
  setTimeout(() => {
    const title = document.getElementById('title')
    title.style.visibility = 'visible'
    title.style.opacity = '0'
    const startedAt = performance.now()
    const step = () => {
      const progress = Math.min(1, (performance.now() - startedAt) / 800)
      title.style.opacity = String(progress)
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, 150)
</script></body>`

const SKELETON_GRID = `<!doctype html><body style="margin:0;background:#fff;font:24px sans-serif">
<header style="height:120px">${'Navigation and brand text. '.repeat(20)}</header>
<main id="grid" style="display:grid;grid-template-columns:repeat(4,300px);gap:16px">
${'<div style="height:200px;background:rgb(235,235,235)"></div>'.repeat(8)}
</main>
<script>
  setTimeout(() => {
    document.getElementById('grid').innerHTML = Array.from({ length: 8 }, () =>
      '<div style="height:200px;background:rgb(30,160,60);color:#fff">Card</div>').join('')
  }, 700)
</script></body>`

const ENDLESS_SHIFT = `<!doctype html><body style="margin:0;font:32px sans-serif">
<div id="bar" style="height:10px"></div>
${'<p>Content that keeps being pushed down by the bar above it.</p>'.repeat(20)}
<img src="/slow.gif" width="1" height="1">
<script>
  let grow = true
  setInterval(() => {
    const bar = document.getElementById('bar')
    bar.style.height = (grow ? 200 : 10) + 'px'
    grow = !grow
  }, 80)
</script></body>`

const BUSY_MAIN_THREAD = ENDLESS_SHIFT.replace(
  '</script></body>',
  `window.addEventListener('load', () => setTimeout(() => {
    const until = Date.now() + 8000
    while (Date.now() < until) {}
  }, 100))
</script></body>`
)

const STATIC_CANVAS = `<!doctype html><body style="margin:0;height:3000px">
<canvas id="art" width="1280" height="2000" style="display:block"></canvas>
<script>
  const context = document.getElementById('art').getContext('2d')
  const gradient = context.createLinearGradient(0, 0, 1280, 2000)
  gradient.addColorStop(0, 'rgb(30,60,200)')
  gradient.addColorStop(1, 'rgb(200,60,30)')
  context.fillStyle = gradient
  context.fillRect(0, 0, 1280, 2000)
</script></body>`

const MUTED_TEXT = `<!doctype html><body style="margin:0;font:28px sans-serif">
${'<p style="opacity:0.6">Secondary copy that is designed to stay semi transparent.</p>'.repeat(20)}
</body>`

const DECORATED_PAGE = STATIC_PAGE.replace(
  '<body style="margin:0;font:32px sans-serif">',
  `<body style="margin:0;font:32px sans-serif">
<style>
  @keyframes glow { from { opacity: 0.4 } to { opacity: 1 } }
  .shimmerLayer { display:inline-block; width:112px; height:28px; animation: glow 7500ms linear }
</style>
<button><span class="shimmerLayer"></span>Ask AI</button>
<div style="position:absolute;top:0;left:0;opacity:0;pointer-events:none;width:480px;height:110px">A tooltip that only shows on hover</div>
${'<a style="display:block;width:48px;height:48px;border-radius:100%;background:#fff"></a>'.repeat(
  3
)}`
)

test('a ready viewport reports no symptom', t => {
  t.deepEqual(symptomsOf(READY), [])
})

test('every unfinished signal is named', t => {
  const unfinished = {
    ...READY,
    coverage: 0.1,
    pendingImages: 1,
    loadingVideos: 1,
    finiteAnimations: 1,
    skeletons: 3,
    shifting: true,
    fadingChanged: true,
    pendingReveals: 1,
    unsizedCanvases: 1
  }
  t.deepEqual(symptomsOf(unfinished), [
    'sparse',
    'images',
    'video',
    'animation',
    'skeleton',
    'shifting',
    'fading',
    'reveal',
    'canvas'
  ])
})

test('a sparse viewport settles only after a long quiet and no young same-site request', t => {
  const sparse = { ...READY, coverage: 0.1 }
  t.false(isSettled({ ...sparse, sinceMutation: 200 }, ['sparse'], 0))
  t.false(isSettled({ ...sparse, sinceMutation: 1000 }, ['sparse'], 1))
  t.true(isSettled({ ...sparse, sinceMutation: 1000 }, ['sparse'], 0))
})

test('any symptom other than sparse keeps the viewport unsettled', t => {
  t.false(isSettled(READY, ['images'], 0))
  t.true(isSettled(READY, [], 0))
  t.false(isSettled({ ...READY, sinceMutation: 100 }, [], 0))
})

test('a finished page is captured without waiting', async t => {
  const result = await settleOn(t, STATIC_PAGE)
  t.true(result.settled)
  t.deepEqual(result.symptoms, [])
  t.true(result.waited < 200, `waited ${result.waited}ms`)
})

test('an empty viewport waits until the page mounts its hero', async t => {
  const result = await settleOn(t, FRAME_GATED_HERO)
  t.true(result.settled)
  t.true(result.symptoms.includes('sparse'), result.symptoms.join(','))
})

test('a scripted fade-in waits until the text is opaque', async t => {
  const result = await settleOn(t, SCRIPTED_FADE)
  t.true(result.settled)
  t.true(
    result.symptoms.some(symptom => symptom === 'reveal' || symptom === 'fading'),
    result.symptoms.join(',')
  )
  t.true(result.waited >= 800, `waited ${result.waited}ms`)
})

test('a grid of grey placeholders waits for the real cards', async t => {
  const result = await settleOn(t, SKELETON_GRID)
  t.true(result.settled)
  t.true(result.symptoms.includes('skeleton'), result.symptoms.join(','))
})

test('a page that never settles is released at the cap', async t => {
  const result = await settleOn(t, ENDLESS_SHIFT)
  t.false(result.settled)
  t.true(result.symptoms.includes('shifting'), result.symptoms.join(','))
  t.true(result.waited <= SETTLE_CAP_MS + 500, `waited ${result.waited}ms`)
})

test('a screenshot captures the hero a frame-gated page mounts after load', async t => {
  const [red, green, blue] = await centerPixel(await shoot(t, FRAME_GATED_HERO))
  t.true(red > 180 && green < 80 && blue < 80, `rgb(${red},${green},${blue})`)
})

test('a screenshot captures a scripted fade-in at full opacity', async t => {
  const [red, green, blue] = await centerPixel(await shoot(t, SCRIPTED_FADE))
  t.true(red < 60 && green < 60 && blue > 160, `rgb(${red},${green},${blue})`)
})

test('a timeout that is not a number still stops at the cap', async t => {
  const result = await settleOn(t, ENDLESS_SHIFT, { timeout: NaN })
  t.false(result.settled)
  t.true(result.symptoms.includes('shifting'), result.symptoms.join(','))
  t.true(result.waited >= SETTLE_CAP_MS - 500, `waited ${result.waited}ms`)
  t.true(result.waited <= SETTLE_CAP_MS + 500, `waited ${result.waited}ms`)
})

test('a blocked main thread does not hold the wait past the cap', async t => {
  const result = await settleOn(t, BUSY_MAIN_THREAD, { timeout: SETTLE_CAP_MS })
  t.false(result.settled)
  t.true(result.waited <= SETTLE_CAP_MS + 500, `waited ${result.waited}ms`)
})

test('a static canvas settles after scroll', async t => {
  const result = await settleOn(t, STATIC_CANVAS, {
    beforeWait: page => page.evaluate(() => window.scrollTo(0, 1000))
  })
  t.true(result.settled)
  t.true(result.waited < 1000, `waited ${result.waited}ms`)
})

test('text that stays semi transparent costs one extra read', async t => {
  const result = await settleOn(t, MUTED_TEXT)
  t.true(result.settled)
  t.true(result.waited < 300, `waited ${result.waited}ms`)
})

test('decorative ui is not mistaken for unfinished work', async t => {
  const result = await settleOn(t, DECORATED_PAGE)
  t.true(result.settled)
  t.deepEqual(result.symptoms, [])
  t.true(result.waited < 200, `waited ${result.waited}ms`)
})

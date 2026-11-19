'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const { default: test } = require('ava')
const sharp = require('sharp')

const createScreenshot = require('..')
const createSettle = require('../src/settle')
const { evaluateIsolated } = require('../src/evaluate-isolated')
const {
  symptomsOf,
  isSettled,
  isSameSite,
  createRequestTracker,
  SETTLE_CAP_MS
} = require('../src/settle')

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
    const path = req.url.split('?')[0]
    if (
      path === '/slow.gif' ||
      path === '/slow-mid' ||
      path === '/slow-long' ||
      path === '/slow.mp4'
    ) {
      const ms = path === '/slow-long' ? 5000 : path === '/slow.gif' ? SLOW_ASSET_MS : 1200
      await new Promise(resolve => setTimeout(resolve, ms))
      if (path === '/slow.gif') {
        res.setHeader('content-type', 'image/gif')
        return res.end(PIXEL)
      }
      if (path === '/slow.mp4') {
        res.setHeader('content-type', 'video/mp4')
        return res.end(PIXEL)
      }
      res.setHeader('content-type', 'text/html')
      return res.end('<p>Loaded</p>')
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
  }, 0))
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
  .shimmerLayer { display:inline-block; width:112px; height:48px; animation: glow 7500ms linear }
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
  t.true(isSettled(READY, [], 4))
  t.false(isSettled({ ...READY, sinceMutation: 100 }, [], 0))
})

test('a moving canvas is unfinished even when it has a real size', t => {
  t.deepEqual(symptomsOf({ ...READY, canvasUnsettled: true }), ['canvas'])
})

test('same-site follows the registrable name, including addresses', t => {
  t.true(isSameSite('https://www.example.co.uk/a', 'https://example.co.uk/b'))
  t.false(isSameSite('https://a.co.uk/', 'https://b.co.uk/'))
  t.true(isSameSite('https://foo.github.io/a', 'https://bar.github.io/b'))
  t.false(isSameSite('https://example.com/a', 'https://example.org/b'))
  t.true(isSameSite('http://127.0.0.1/a', 'http://127.0.0.1/b'))
  t.false(isSameSite('http://127.0.0.1/a', 'http://10.0.0.1/b'))
  t.true(isSameSite('http://[::1]/a', 'http://[::1]/b'))
  t.false(isSameSite('http://[::1]/a', 'http://[2001:db8::1]/b'))
  t.false(isSameSite('not a url', 'https://example.com/'))
})

const fakeRequest = (url, type) => ({ url: () => url, resourceType: () => type })

const openTracker = () => {
  const listeners = {}
  let current = 'http://127.0.0.1/page'
  const page = {
    url: () => current,
    on: (event, fn) => {
      listeners[event] = fn
    },
    off: () => {}
  }
  return {
    tracker: createRequestTracker(page),
    listeners,
    setUrl: value => {
      current = value
    }
  }
}

test('a young same-site request is counted for every blocking type', t => {
  for (const type of ['document', 'stylesheet', 'font', 'script', 'xhr', 'fetch']) {
    const { tracker, listeners } = openTracker()
    listeners.request(fakeRequest('http://127.0.0.1/asset', type))
    t.is(tracker.young(), 1, type)
  }
})

test('a request that is cross-site, finished, failed, or not blocking does not count', t => {
  const { tracker, listeners, setUrl } = openTracker()
  listeners.request(fakeRequest('http://127.0.0.1/a.png', 'image'))
  listeners.request(fakeRequest('http://127.0.0.1/a.mp4', 'media'))
  listeners.request(fakeRequest('http://10.0.0.1/a.js', 'script'))
  t.is(tracker.young(), 0)

  setUrl('about:blank')
  const early = fakeRequest('http://127.0.0.1/app.js', 'script')
  listeners.request(early)
  t.is(tracker.young(), 0)
  setUrl('http://127.0.0.1/page')
  t.is(tracker.young(), 1)
  listeners.requestfinished(early)
  t.is(tracker.young(), 0)

  const failed = fakeRequest('http://127.0.0.1/data', 'xhr')
  listeners.request(failed)
  listeners.requestfailed(failed)
  t.is(tracker.young(), 0)
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

test('a short timeout stops before the cap', async t => {
  const result = await settleOn(t, ENDLESS_SHIFT, { timeout: 700 })
  t.false(result.settled)
  t.true(result.waited >= 500, `waited ${result.waited}ms`)
  t.true(result.waited <= 1200, `waited ${result.waited}ms`)
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

const PARAGRAPHS = '<p>Paragraph of supporting copy for the viewport.</p>'.repeat(16)

const ARIA_BUSY = STATIC_PAGE.replace(
  '<body style="margin:0;font:32px sans-serif">',
  `<body style="margin:0;font:32px sans-serif">
<p id="status" aria-busy="true" style="height:64px">Loading the latest figures</p>
<script>setTimeout(() => document.getElementById('status').removeAttribute('aria-busy'), 500)</script>`
)

const SKELETON_CLASS_PAGE = STATIC_PAGE.replace(
  '<body style="margin:0;font:32px sans-serif">',
  `<body style="margin:0;font:32px sans-serif">
<div id="block" class="skeleton-card" style="height:80px;background:rgb(200,30,30)"></div>
<script>setTimeout(() => { document.getElementById('block').className = '' }, 500)</script>`
)

const ENTRANCE = `<!doctype html><body style="margin:0;font:32px sans-serif">
<style>
  @keyframes arrive { from { background-color: rgb(10, 10, 10) } to { background-color: rgb(220, 30, 30) } }
  .hero { animation: arrive 1s linear forwards; height: 420px }
</style>
<div class="hero">A headline that is already long enough to read.</div>
${PARAGRAPHS}
</body>`

const ENDLESS_GHOST = `<!doctype html><body style="margin:0;font:32px sans-serif">
<style>
  @keyframes pulse { from { opacity: 0.35 } to { opacity: 1 } }
  .ghost { width: 240px; height: 160px; background: rgb(220, 220, 220); animation: pulse 700ms linear infinite }
</style>
<div class="ghost"></div>
${PARAGRAPHS}
</body>`

const HIDDEN_IMPORTANT = `<!doctype html><body style="margin:0">
<canvas id="art" width="1280" height="800" style="display:block"></canvas>
<h1 id="title" style="Opacity: 0 !important;position:relative;margin:-800px 0 0;height:800px;background:rgb(20,20,200);color:#fff;font-size:120px">Headline</h1>
<script>
  const context = document.getElementById('art').getContext('2d')
  context.fillStyle = 'rgb(30,60,200)'
  context.fillRect(0, 0, 1280, 800)
  setTimeout(() => { document.getElementById('title').style.opacity = '1' }, 500)
</script></body>`

const flatCanvas = color => `<!doctype html><body style="margin:0">
<canvas id="art" width="1280" height="800" style="display:block"></canvas>
<script>
  const context = document.getElementById('art').getContext('2d')
  context.fillStyle = '${color}'
  context.fillRect(0, 0, 1280, 800)
</script></body>`

const SPARSE_PAGE = '<!doctype html><body style="margin:0;background:#fff"></body>'

test('a loading image keeps the viewport unsettled', async t => {
  const result = await settleOn(t, STATIC_PAGE, {
    beforeWait: page =>
      page.evaluate(src => {
        const image = document.createElement('img')
        image.width = 480
        image.height = 320
        image.alt = ''
        image.src = src
        document.body.prepend(image)
      }, '/slow.gif')
  })
  t.true(result.settled)
  t.true(result.symptoms.includes('images'), result.symptoms.join(','))
  t.true(result.waited >= SLOW_ASSET_MS - 100, `waited ${result.waited}ms`)
})

test('a loading background image keeps the viewport unsettled', async t => {
  const paints = [
    () => {
      document.body.style.height = '800px'
      document.body.style.background = 'url(/slow.gif) center/cover no-repeat'
    },
    () => {
      const block = document.createElement('div')
      block.style.cssText = 'height:800px;background:url(/slow.gif) center/cover no-repeat'
      document.body.appendChild(block)
    }
  ]
  for (const paint of paints) {
    const result = await settleOn(t, '<!doctype html><body style="margin:0"></body>', {
      beforeWait: page => page.evaluate(paint)
    })
    t.true(result.settled)
    t.true(result.symptoms.includes('images'), result.symptoms.join(','))
    t.true(result.waited >= SLOW_ASSET_MS - 100, `waited ${result.waited}ms`)
  }
})

test('aria-busy keeps the viewport unsettled until it clears', async t => {
  const result = await settleOn(t, ARIA_BUSY)
  t.true(result.settled)
  t.true(result.symptoms.includes('skeleton'), result.symptoms.join(','))
  t.true(result.waited >= 400, `waited ${result.waited}ms`)
})

test('a skeleton class keeps the viewport unsettled until it clears', async t => {
  const result = await settleOn(t, SKELETON_CLASS_PAGE)
  t.true(result.settled)
  t.true(result.symptoms.includes('skeleton'), result.symptoms.join(','))
  t.true(result.waited >= 400, `waited ${result.waited}ms`)
})

test('a short entrance animation is waited out', async t => {
  const result = await settleOn(t, ENTRANCE)
  t.true(result.settled)
  t.true(result.symptoms.includes('animation'), result.symptoms.join(','))
  t.true(result.waited >= 800, `waited ${result.waited}ms`)
})

test('an endless shimmer on an empty box holds until the cap', async t => {
  const result = await settleOn(t, ENDLESS_GHOST)
  t.false(result.settled)
  t.true(result.symptoms.includes('skeleton'), result.symptoms.join(','))
  t.true(result.waited >= SETTLE_CAP_MS - 500, `waited ${result.waited}ms`)
})

test('hidden text declared with important and mixed case is waited out', async t => {
  const result = await settleOn(t, HIDDEN_IMPORTANT)
  t.true(result.settled)
  t.true(result.symptoms.includes('reveal'), result.symptoms.join(','))
  t.true(result.waited >= 400, `waited ${result.waited}ms`)
})

test('a flat painted canvas settles and a black one does not', async t => {
  const painted = await settleOn(t, flatCanvas('rgb(220,30,30)'))
  t.true(painted.settled)
  t.true(painted.waited < 1000, `waited ${painted.waited}ms`)

  const blank = await settleOn(t, flatCanvas('black'))
  t.false(blank.settled)
  t.true(blank.symptoms.includes('canvas'), blank.symptoms.join(','))
  t.true(blank.waited >= SETTLE_CAP_MS - 500, `waited ${blank.waited}ms`)
})

test('a loading video keeps the viewport unsettled', async t => {
  const result = await settleOn(t, '<!doctype html><body style="margin:0"></body>', {
    timeout: 5000,
    beforeWait: page =>
      page.evaluate(() => {
        const video = document.createElement('video')
        video.width = 640
        video.height = 360
        video.muted = true
        video.autoplay = true
        video.src = '/slow.mp4'
        document.body.prepend(video)
        return new Promise(resolve => setTimeout(resolve, 50))
      })
  })
  t.true(result.symptoms.includes('video'), result.symptoms.join(','))
  t.true(result.waited >= 800, `waited ${result.waited}ms`)
})

test('a same-origin frame that is still loading keeps the viewport waiting', async t => {
  const result = await settleOn(t, '<!doctype html><body style="margin:0"></body>', {
    timeout: 5000,
    beforeWait: page =>
      page.evaluate(() => {
        const frame = document.createElement('iframe')
        frame.src = '/slow-mid'
        frame.style.cssText = 'width:1280px;height:800px;border:0'
        document.body.appendChild(frame)
      })
  })
  t.true(result.settled)
  t.true(result.waited >= 1000, `waited ${result.waited}ms`)
})

test('a young same-site fetch holds a sparse viewport until the request ages out', async t => {
  const result = await settleOn(t, SPARSE_PAGE, {
    timeout: 8000,
    beforeWait: page =>
      page.evaluate(() => {
        fetch('/slow-long')
      })
  })
  t.true(result.settled)
  t.true(result.waited >= 1600, `waited ${result.waited}ms`)
  t.true(result.waited <= 2800, `waited ${result.waited}ms`)
})

test('a load screenshot does not wait for a hero that mounts later', async t => {
  const late = FRAME_GATED_HERO.replace('frames < 30', 'frames < 60')
  const [red, green, blue] = await centerPixel(await shoot(t, late, { waitUntil: 'load' }))
  t.true(red < 40 && green < 40 && blue < 40, `rgb(${red},${green},${blue})`)
})

test('settle state is removed when the screenshot returns', async t => {
  const browserless = await getBrowserContext(t)
  const url = await serve(t, STATIC_PAGE)
  await browserless.withPage((page, goto) => async () => {
    await page.setViewport({ width: 1280, height: 800 })
    await createScreenshot({ goto })(page)(url, {
      adblock: false,
      timeout: 20000,
      type: 'png'
    })
    t.false(await evaluateIsolated(page, () => Boolean(window.__browserlessSettle)))
  })()
})

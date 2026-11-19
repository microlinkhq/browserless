'use strict'

const debug = require('debug-logfmt')('browserless:screenshot:settle')
const { setTimeout: delay } = require('node:timers/promises')
const sharp = require('sharp')

const { evaluateIsolated } = require('./evaluate-isolated')

const SETTLE_CAP_MS = 3000
const POLL_MS = 50
const QUIET_MS = 150
const SPARSE_QUIET_MS = 700
const LOW_COVERAGE = 0.3
const YOUNG_REQUEST_MS = 2000
const BLOCKING_REQUEST_TYPES = new Set(['document', 'stylesheet', 'font', 'script', 'xhr', 'fetch'])
const CANVAS_PROBE_SCALE = 1 / 16
const BLANK_CANVAS_STDEV = 2
const BLANK_CANVAS_MEAN = 8
const CANVAS_DRIFT = 2.5
const CANVAS_STABLE_MS = 300
const STOP_TIMEOUT_MS = 250
const COMPARED_SYMPTOMS = new Set(['fading', 'canvas'])
const TIMED_OUT = Symbol('timed out')

const withDeadline = async (promise, ms) => {
  const controller = new AbortController()
  try {
    return await Promise.race([promise, delay(ms, TIMED_OUT, { signal: controller.signal })])
  } finally {
    controller.abort()
  }
}

const siteOf = hostname => {
  if (hostname.includes(':') || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return hostname
  const labels = hostname.split('.')
  const secondLevel = labels[labels.length - 2] || ''
  const isCountrySecondLevel =
    labels.length > 2 && labels[labels.length - 1].length === 2 && secondLevel.length <= 3
  return labels.slice(isCountrySecondLevel ? -3 : -2).join('.')
}

const isSameSite = (a, b) => {
  try {
    return siteOf(new URL(a).hostname) === siteOf(new URL(b).hostname)
  } catch {
    return false
  }
}

const readViewport = async () => {
  const MIN_SHIFT = 0.005
  const RECENT_SHIFT_MS = 200
  const COLUMNS = 32
  const ROWS = 20
  const MAX_TEXT_NODES = 1500
  const MAX_ELEMENTS = 4000
  const MIN_VISIBLE_OPACITY = 0.2
  const MIN_PARTIAL_OPACITY = 0.05
  const MAX_PARTIAL_OPACITY = 0.98
  const MIN_MEDIA_SIDE = 32
  const MIN_CANVAS_SHARE = 0.1
  const MIN_REVEAL_SHARE = 0.01
  const MIN_PLACEHOLDER_AREA = 2500
  const MIN_WHITE_CHANNEL = 250
  const MAX_ENTRANCE_ANIMATION_MS = 2000
  const INTERACTIVE = 'a, button, [role="button"], input, select, textarea, label'
  const IN_FLOW_POSITIONS = new Set(['static', 'relative'])
  const MIN_PLACEHOLDER_HEIGHT = 12
  const MIN_PLACEHOLDER_REPEATS = 3
  const MAX_PLACEHOLDER_CHROMA = 24
  const DEFAULT_CANVAS_WIDTH = 300
  const DEFAULT_CANVAS_HEIGHT = 150
  const SKELETON_CLASS = /(^|[\s_-])(skeleton|shimmer)/i
  const INLINE_HIDDEN =
    /(^|;)\s*(?:opacity\s*:\s*0(?:\.0+)?|visibility\s*:\s*hidden)\s*(?:!important\s*)?(?=;|$)/i
  const NON_CONTENT_TAGS = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/

  const install = () => {
    const tracker = { lastMutation: performance.now(), lastShift: null }
    const mutations = new window.MutationObserver(records => {
      for (const record of records) {
        const target = record.target.nodeType === 1 ? record.target : record.target.parentElement
        if (!target || !target.isConnected) continue
        const r = target.getBoundingClientRect()
        if (
          r.width * r.height > 0 &&
          r.bottom > 0 &&
          r.right > 0 &&
          r.top < window.innerHeight &&
          r.left < window.innerWidth
        ) {
          tracker.lastMutation = performance.now()
          return
        }
      }
    })
    mutations.observe(document, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'src', 'srcset', 'hidden', 'poster', 'aria-busy']
    })
    const shifts = new window.PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        if (entry.value >= MIN_SHIFT && !entry.hadRecentInput) {
          tracker.lastShift = entry.startTime + entry.duration
        }
      }
    })
    try {
      shifts.observe({ type: 'layout-shift', buffered: true })
    } catch {}
    tracker.disconnect = () => {
      mutations.disconnect()
      shifts.disconnect()
    }
    return tracker
  }

  if (!window.__browserlessSettle) {
    window.__browserlessSettle = install()
    await new Promise(resolve => setTimeout(resolve, 0))
  }
  const tracker = window.__browserlessSettle

  const vw = window.innerWidth
  const vh = window.innerHeight
  const now = performance.now()

  const opacityCache = new Map()
  const effectiveOpacity = el => {
    if (!el || el.nodeType !== 1) return 1
    if (opacityCache.has(el)) return opacityCache.get(el)
    const style = window.getComputedStyle(el)
    const own = style.visibility === 'hidden' ? 0 : parseFloat(style.opacity)
    const value = own * effectiveOpacity(el.parentElement)
    opacityCache.set(el, value)
    return value
  }
  const isVisible = el => effectiveOpacity(el) >= MIN_VISIBLE_OPACITY
  const intersects = r => r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
  const isMediaInViewport = el => {
    const r = el.getBoundingClientRect()
    return r.width > MIN_MEDIA_SIDE && r.height > MIN_MEDIA_SIDE && intersects(r)
  }
  const clipToViewport = r => {
    const left = Math.max(0, r.left)
    const top = Math.max(0, r.top)
    return {
      x: left,
      y: top,
      width: Math.min(vw, r.right) - left,
      height: Math.min(vh, r.bottom) - top
    }
  }

  const cells = new Uint8Array(COLUMNS * ROWS)
  const cover = r => {
    const { x, y, width, height } = clipToViewport(r)
    if (width <= 0 || height <= 0) return
    const cellW = vw / COLUMNS
    const cellH = vh / ROWS
    for (
      let row = Math.floor(y / cellH);
      row < Math.min(ROWS, Math.ceil((y + height) / cellH));
      row++
    ) {
      for (
        let column = Math.floor(x / cellW);
        column < Math.min(COLUMNS, Math.ceil((x + width) / cellW));
        column++
      ) {
        cells[row * COLUMNS + column] = 1
      }
    }
  }

  let pendingImages = 0
  for (const img of document.images) {
    if (img.naturalWidth > 0 && img.complete && isVisible(img)) cover(img.getBoundingClientRect())
    else if (!img.complete && isMediaInViewport(img)) pendingImages++
  }

  let loadingVideos = 0
  for (const video of document.querySelectorAll('video')) {
    if ((video.readyState >= 2 || video.poster) && isVisible(video)) {
      cover(video.getBoundingClientRect())
    }
    if (
      video.readyState < 2 &&
      !video.error &&
      video.networkState === 2 &&
      isMediaInViewport(video)
    ) {
      loadingVideos++
    }
  }

  let canvasClip = null
  let unsizedCanvases = 0
  let pendingFrames = 0
  for (const el of document.querySelectorAll('canvas, svg, iframe, object, embed')) {
    if (!isVisible(el)) continue
    const r = el.getBoundingClientRect()
    if (el.tagName === 'IFRAME') {
      try {
        const doc = el.contentDocument
        if (doc) {
          const pending =
            doc.readyState !== 'complete' ||
            (el.src &&
              el.src !== 'about:blank' &&
              new URL(doc.URL).href !== new URL(el.src, document.baseURI).href)
          if (pending) {
            pendingFrames++
            continue
          }
        }
      } catch {}
    }
    cover(r)
    if (el.tagName !== 'CANVAS' || !intersects(r)) continue
    if (el.width === DEFAULT_CANVAS_WIDTH && el.height === DEFAULT_CANVAS_HEIGHT) unsizedCanvases++
    const clip = clipToViewport(r)
    if (clip.width * clip.height < vw * vh * MIN_CANVAS_SHARE) continue
    if (!canvasClip || clip.width * clip.height > canvasClip.width * canvasClip.height) {
      canvasClip = clip
    }
  }

  const backgroundUrls = value =>
    [...value.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map(match => match[1])
  const paintBackground = (el, style, rect) => {
    if (!isVisible(el) || style.backgroundImage === 'none') return
    const urls = backgroundUrls(style.backgroundImage)
    if (urls.length === 0) {
      cover(rect)
      return
    }
    let pending = false
    let loaded = true
    for (const url of urls) {
      const probe = new window.Image()
      probe.src = url
      if (!probe.complete) {
        pending = true
        loaded = false
      } else if (!(probe.naturalWidth > 0)) loaded = false
    }
    if (pending && isMediaInViewport(el)) pendingImages++
    else if (loaded) cover(rect)
  }
  for (const el of [document.documentElement, document.body]) {
    if (el) paintBackground(el, window.getComputedStyle(el), el.getBoundingClientRect())
  }

  const isNeutral = color => {
    if (!/^rgba?\(/.test(color)) return false
    const [r, g, b, a = 1] = (color.match(/[\d.]+/g) || []).map(Number)
    return (
      a > 0 &&
      Math.min(r, g, b) < MIN_WHITE_CHANNEL &&
      Math.max(r, g, b) - Math.min(r, g, b) <= MAX_PLACEHOLDER_CHROMA
    )
  }
  const placeholderSizes = new Map()
  let skeletons = 0
  let scanned = 0
  for (const el of document.querySelectorAll('body *')) {
    if (++scanned > MAX_ELEMENTS) break
    const r = el.getBoundingClientRect()
    if (!intersects(r) || r.width * r.height === 0) continue
    const style = window.getComputedStyle(el)
    paintBackground(el, style, r)
    const className = typeof el.className === 'string' ? el.className : ''
    const isInteractive = el.closest(INTERACTIVE) !== null
    if (
      (el.getAttribute('aria-busy') === 'true' || SKELETON_CLASS.test(className)) &&
      !isInteractive &&
      isVisible(el)
    ) {
      skeletons++
    }
    if (
      isInteractive ||
      r.width * r.height < MIN_PLACEHOLDER_AREA ||
      r.height < MIN_PLACEHOLDER_HEIGHT ||
      el.childElementCount > 2 ||
      style.backgroundImage !== 'none' ||
      style.maskImage !== 'none' ||
      style.webkitMaskImage !== 'none' ||
      !isNeutral(style.backgroundColor) ||
      el.textContent.trim() ||
      el.querySelector('img, svg, canvas, video, iframe, picture') ||
      !isVisible(el)
    ) {
      continue
    }
    const size = `${Math.round(r.width / 8)}x${Math.round(r.height / 8)}`
    placeholderSizes.set(size, (placeholderSizes.get(size) || 0) + 1)
  }
  const placeholders = Math.max(0, ...placeholderSizes.values())

  const fadingText = []
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    window.NodeFilter.SHOW_TEXT
  )
  const range = document.createRange()
  let textNodes = 0
  for (let node = walker.nextNode(); node && textNodes < MAX_TEXT_NODES; node = walker.nextNode()) {
    const parent = node.parentElement
    if (!parent || !node.nodeValue.trim() || NON_CONTENT_TAGS.test(parent.tagName)) continue
    textNodes++
    range.selectNodeContents(node)
    const r = range.getBoundingClientRect()
    if (!intersects(r) || r.width === 0) continue
    const opacity = effectiveOpacity(parent)
    if (opacity > MIN_PARTIAL_OPACITY && opacity < MAX_PARTIAL_OPACITY) {
      fadingText.push(opacity.toFixed(2))
    }
    if (opacity >= MIN_VISIBLE_OPACITY) for (const line of range.getClientRects()) cover(line)
  }

  const isTextVisibleAt = (x, y, hidden) =>
    document
      .elementsFromPoint(x, y)
      .some(
        el => !hidden.contains(el) && !el.contains(hidden) && el.textContent.trim() && isVisible(el)
      )
  let pendingReveals = 0
  let styled = 0
  for (const el of document.querySelectorAll('body [style]')) {
    if (++styled > MAX_ELEMENTS) break
    if (!INLINE_HIDDEN.test(el.getAttribute('style')) || !el.textContent.trim()) continue
    const r = el.getBoundingClientRect()
    if (r.width * r.height < vw * vh * MIN_REVEAL_SHARE || !intersects(r)) continue
    if (!IN_FLOW_POSITIONS.has(window.getComputedStyle(el).position)) continue
    const { x, y, width, height } = clipToViewport(r)
    if (!isTextVisibleAt(x + width / 2, y + height / 2, el)) pendingReveals++
  }

  let finiteAnimations = 0
  let shimmerAnimations = 0
  for (const animation of document.getAnimations()) {
    if (animation.playState !== 'running' || !animation.effect) continue
    const timing = animation.effect.getComputedTiming()
    const target = animation.effect.target
    if (!target || !isMediaInViewport(target)) continue
    const isEndless = !Number.isFinite(timing.endTime)
    if (!isEndless && timing.endTime <= MAX_ENTRANCE_ANIMATION_MS) finiteAnimations++
    if (
      isEndless &&
      !target.closest?.(INTERACTIVE) &&
      !target.textContent.trim() &&
      !target.querySelector('img, video, svg, canvas')
    ) {
      shimmerAnimations++
    }
  }

  return {
    coverage: cells.reduce((sum, cell) => sum + cell, 0) / cells.length,
    pendingImages,
    loadingVideos,
    finiteAnimations,
    skeletons:
      skeletons + shimmerAnimations + (placeholders >= MIN_PLACEHOLDER_REPEATS ? placeholders : 0),
    shifting: tracker.lastShift !== null && now - tracker.lastShift < RECENT_SHIFT_MS,
    fadingSignature: fadingText.join(','),
    pendingReveals,
    pendingFrames,
    unsizedCanvases,
    canvasClip: canvasClip && {
      ...canvasClip,
      x: canvasClip.x + window.scrollX,
      y: canvasClip.y + window.scrollY
    },
    sinceMutation: now - tracker.lastMutation
  }
}

const SYMPTOMS = [
  ['sparse', state => state.coverage < LOW_COVERAGE],
  ['images', state => state.pendingImages > 0],
  ['video', state => state.loadingVideos > 0],
  ['frame', state => state.pendingFrames > 0],
  ['animation', state => state.finiteAnimations > 0],
  ['skeleton', state => state.skeletons > 0],
  ['shifting', state => state.shifting],
  ['fading', state => state.fadingChanged],
  ['reveal', state => state.pendingReveals > 0],
  ['canvas', state => state.unsizedCanvases > 0 || state.canvasUnsettled]
]

const symptomsOf = state => SYMPTOMS.filter(([, test]) => test(state)).map(([name]) => name)

const readCanvas = async (cdp, clip) => {
  const result = await cdp.send('Page.captureScreenshot', {
    format: 'png',
    clip: { ...clip, scale: CANVAS_PROBE_SCALE },
    captureBeyondViewport: false
  })
  const { channels } = await sharp(Buffer.from(result.data, 'base64')).removeAlpha().stats()
  return channels.map(({ mean, stdev }) => ({ mean, stdev }))
}

const canvasDrift = (previous, current) =>
  current.reduce(
    (sum, channel, index) =>
      sum +
      Math.abs(channel.mean - previous[index].mean) +
      Math.abs(channel.stdev - previous[index].stdev),
    0
  )

const createCanvasTracker = page => {
  let cdp
  let previous
  let stableSince = null
  let dropped = false
  return {
    unsettled: async clip => {
      if (!clip || dropped) return false
      cdp = cdp || (await page.createCDPSession())
      if (dropped) return false
      const current = await readCanvas(cdp, clip)
      if (dropped) return false
      const isBlank = current.every(
        channel => channel.stdev < BLANK_CANVAS_STDEV && channel.mean < BLANK_CANVAS_MEAN
      )
      const isStable = previous !== undefined && canvasDrift(previous, current) < CANVAS_DRIFT
      stableSince = isStable ? stableSince ?? Date.now() : null
      previous = current
      return isBlank || stableSince === null || Date.now() - stableSince < CANVAS_STABLE_MS
    },
    drop () {
      dropped = true
      const session = cdp
      cdp = undefined
      return session && session.detach().catch(() => {})
    },
    close () {
      return this.drop()
    }
  }
}

const createRequestTracker = page => {
  const inflight = new Map()
  const onRequest = request => {
    if (!BLOCKING_REQUEST_TYPES.has(request.resourceType())) return
    inflight.set(request, Date.now())
  }
  const onDone = request => inflight.delete(request)
  page.on('request', onRequest)
  page.on('requestfinished', onDone)
  page.on('requestfailed', onDone)
  return {
    young: () => {
      const now = Date.now()
      const pageUrl = page.url()
      let count = 0
      for (const [request, startedAt] of inflight) {
        if (now - startedAt >= YOUNG_REQUEST_MS) continue
        if (!isSameSite(request.url(), pageUrl)) continue
        count++
      }
      return count
    },
    close: () => {
      page.off('request', onRequest)
      page.off('requestfinished', onDone)
      page.off('requestfailed', onDone)
    }
  }
}

const isSettled = (state, symptoms, youngRequests) => {
  const sparse = symptoms.includes('sparse')
  if (symptoms.some(symptom => symptom !== 'sparse')) return false
  if (sparse && youngRequests > 0) return false
  return state.sinceMutation >= (sparse ? SPARSE_QUIET_MS : QUIET_MS)
}

const createSettle = page => {
  const requests = createRequestTracker(page)
  const canvas = createCanvasTracker(page)
  let previousFading = ''

  const inspect = async () => {
    const state = await evaluateIsolated(page, readViewport)
    state.canvasUnsettled = await canvas.unsettled(state.canvasClip).catch(() => false)
    state.fadingChanged = state.fadingSignature !== '' && state.fadingSignature !== previousFading
    previousFading = state.fadingSignature
    return state
  }

  const wait = async ({ timeout = SETTLE_CAP_MS } = {}) => {
    const cap = Number.isFinite(timeout) ? Math.min(SETTLE_CAP_MS, timeout) : SETTLE_CAP_MS
    const startedAt = Date.now()
    const elapsed = () => Date.now() - startedAt
    const seen = new Set()
    let settled = false
    while (true) {
      const state = await withDeadline(
        inspect().catch(() => undefined),
        Math.max(0, cap - elapsed())
      )
      if (state === TIMED_OUT) {
        canvas.drop()
        break
      }
      if (state) {
        const symptoms = symptomsOf(state)
        symptoms.forEach(symptom => seen.add(symptom))
        const onlyCompared = [...seen].every(symptom => COMPARED_SYMPTOMS.has(symptom))
        settled =
          symptoms.length === 0 && onlyCompared
            ? true
            : isSettled(state, symptoms, requests.young())
      }
      if (settled || elapsed() + POLL_MS >= cap) break
      await delay(POLL_MS)
    }
    const result = { settled, waited: elapsed(), symptoms: [...seen] }
    debug(result)
    return result
  }

  const disconnect = () =>
    evaluateIsolated(page, () => {
      if (!window.__browserlessSettle) return
      window.__browserlessSettle.disconnect()
      delete window.__browserlessSettle
    })

  const stop = async () => {
    requests.close()
    await Promise.all([
      withDeadline(
        disconnect().catch(() => {}),
        STOP_TIMEOUT_MS
      ),
      canvas.close()
    ])
  }

  return { wait, stop }
}

module.exports = createSettle
module.exports.symptomsOf = symptomsOf
module.exports.isSettled = isSettled
module.exports.isSameSite = isSameSite
module.exports.createRequestTracker = createRequestTracker
module.exports.SETTLE_CAP_MS = SETTLE_CAP_MS

'use strict'

// Navigation-tolerant readiness gate. Resolves once the page has been visually
// quiet — document height stable, every image decoded, `readyState` complete —
// for `quietMs`, bounded by `timeout`. Unlike a screenshot poll it takes no
// screenshots (which are expensive under software rendering, e.g. the GPU-less
// fleet's llvmpipe) and it survives a client-side navigation: when the
// execution context is destroyed mid-check the quiet window resets and polling
// continues instead of throwing (SPAs re-commit their own URL after load).

const { setTimeout: sleep } = require('node:timers/promises')
const { isContextDestroyed } = require('@browserless/errors')

// Evaluated in-page: cheap paint/settle signals (not a screenshot). `images`
// counts only images expected to settle: a lazy image well below the viewport
// sits outside Chromium's lazy-load fetch threshold and never starts loading
// without a scroll, so counting it could only stall the gate into its timeout.
// `decoded` counts every counted image that finished loading — a broken `<img>`
// counts too, so it can't stall the settle gate — while `painted` counts only
// images a screenshot would actually see: successfully decoded, rendered at a
// visible size (a 16×16 box or larger, so a tracking pixel doesn't count),
// inside the viewport, and not hidden via CSS — so a blank shell can't pass for
// content. `text` is the equivalent paint signal for imageless pages: visible
// characters inside the viewport, counted up to 200 (the threshold consumers
// rely on) and skipping text whose color matches its effective background
// (invisible on capture), and `fonts` reports whether webfonts finished
// loading — during a `font-display: block` period text renders invisible,
// exactly when a capture would be white. `covered` reports whether the counted
// content hides behind an opaque viewport-covering layer (a fixed white
// loading overlay passes every DOM signal while a capture stays white):
// hit-testing catches interactive overlays, and a root-level scan catches
// `pointer-events: none` layers hit-testing can't see. `viewport` is the
// in-page viewport height, so consumers can compare it against `height`
// without relying on `page.viewport()`, which is null under
// `defaultViewport: null`.
const paintSignals = () => {
  // A document that is mid-parse or detached can have a null `documentElement`
  // (the same state the text walk below guards against), so every dereference
  // of it goes through `root`.
  const root = document.documentElement
  const vw = window.innerWidth || (root ? root.clientWidth : 0)
  const vh = window.innerHeight || (root ? root.clientHeight : 0)

  // Computed colors resolve to `rgb()`/`rgba()`; anything else is unknown.
  const parseColor = value => {
    const match = /rgba?\(([^)]+)\)/.exec(value || '')
    if (!match) return null
    const parts = match[1].split(',').map(parseFloat)
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length === 4 ? parts[3] : 1 }
  }

  // First opaque background up the ancestor chain; the canvas default (white)
  // when every ancestor is transparent.
  const effectiveBackground = el => {
    for (let node = el; node; node = node.parentElement) {
      const color = parseColor(window.getComputedStyle(node).backgroundColor)
      if (color && color.a >= 0.99) return color
    }
    return { r: 255, g: 255, b: 255, a: 1 }
  }

  const sameColor = (a, b) =>
    Math.abs(a.r - b.r) < 10 && Math.abs(a.g - b.g) < 10 && Math.abs(a.b - b.b) < 10

  // A layer only blanks a capture when it is itself painted solid: visible,
  // full opacity, and an opaque background color or a background image.
  const isOpaqueLayer = el => {
    const style = window.getComputedStyle(el)
    if (style.visibility === 'hidden' || parseFloat(style.opacity) < 0.99) return false
    const background = parseColor(style.backgroundColor)
    return (background && background.a >= 0.99) || style.backgroundImage !== 'none'
  }

  const coversViewport = el => {
    const rect = el.getBoundingClientRect()
    const width = Math.min(rect.right, vw) - Math.max(rect.left, 0)
    const height = Math.min(rect.bottom, vh) - Math.max(rect.top, 0)
    return width > 0 && height > 0 && width * height >= vw * vh * 0.9
  }

  // Up to a handful of counted content samples — enough to hit-test without
  // turning the probe into a layout storm. The clamp keeps each probe point
  // inside the viewport; the rect checks below guarantee it stays inside the
  // sampled content's own box.
  const contentPoints = []
  const samplePoint = (el, rect) => {
    if (contentPoints.length >= 4) return
    contentPoints.push({
      el,
      x: Math.max(0, Math.min(vw - 1, rect.left + rect.width / 2)),
      y: Math.max(0, Math.min(vh - 1, rect.top + rect.height / 2))
    })
  }

  const imgs = document.images
  let images = 0
  let decoded = 0
  let painted = 0
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i]
    if (!img.complete) {
      // Two viewports of headroom stays inside the smallest fetch threshold
      // Chromium uses for lazy images (~1250px on fast connections), so an
      // undecoded lazy image within it is loading and worth waiting for;
      // beyond it, the fetch never starts.
      if (img.loading === 'lazy' && img.getBoundingClientRect().top > vh * 2) continue
      images++
      continue
    }
    images++
    decoded++
    if (img.naturalWidth === 0) continue
    const rect = img.getBoundingClientRect()
    if (rect.width * rect.height < 256) continue
    if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) continue
    if (
      typeof img.checkVisibility === 'function' &&
      !img.checkVisibility({ visibilityProperty: true, opacityProperty: true })
    ) {
      continue
    }
    painted++
    samplePoint(img, rect)
  }
  // Counting stops at 200 chars, so a text-heavy page costs a handful of nodes,
  // not a full DOM walk; only a near-blank shell walks every text node.
  let text = 0
  // A document that is mid-parse or detached can have neither `body` nor
  // `documentElement`, and `createTreeWalker` throws on a null root. Text is only
  // a paint signal, so a count that cannot be taken means "no text seen yet": the
  // gate stays conservative and re-polls, rather than failing a render that would
  // otherwise succeed. The same holds mid-walk — a DOM mutating under the walker
  // must not take the capture down with it.
  const textRoot = document.body || root
  const walker = textRoot
    ? document.createTreeWalker(textRoot, window.NodeFilter.SHOW_TEXT)
    : { nextNode: () => null }
  try {
    while (text < 200) {
      const node = walker.nextNode()
      if (!node) break
      const value = node.nodeValue.trim()
      if (!value) continue
      const el = node.parentElement
      if (!el) continue
      const tag = el.tagName
      if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'TEMPLATE') continue
      if (
        typeof el.checkVisibility === 'function' &&
        !el.checkVisibility({ visibilityProperty: true, opacityProperty: true })
      ) {
        continue
      }
      const range = document.createRange()
      range.selectNodeContents(node)
      const rect = range.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      if (rect.bottom <= 0 || rect.right <= 0 || rect.top >= vh || rect.left >= vw) continue
      // White-on-white (or any color-on-same-color) text passes every geometry
      // check while a capture shows nothing: don't count it as painted text.
      const color = parseColor(window.getComputedStyle(el).color)
      if (color && (color.a < 0.05 || sameColor(color, effectiveBackground(el)))) continue
      text += value.length
      samplePoint(el, rect)
    }
  } catch {
    // Keep whatever was counted before the DOM shifted underneath the walk.
  }

  // Is this content sample's paint hidden behind an unrelated opaque,
  // viewport-covering layer? Walk up from the hit-tested element: anything
  // related to the sample (itself, an ancestor, a descendant) paints with it,
  // and the walk stops at the first common ancestor — an ancestor's background
  // always paints below its own descendants.
  const coveredAt = ({ el, x, y }) => {
    const top = document.elementFromPoint(x, y)
    if (!top) return false
    for (let node = top; node && node !== document.documentElement; node = node.parentElement) {
      if (node === el || node.contains(el) || el.contains(node)) return false
      if (coversViewport(node) && isOpaqueLayer(node)) return true
    }
    return false
  }

  // Only pages the fast path could trust get the (layout-forcing) cover check.
  let covered = false
  if (painted > 0 || text >= 200) {
    covered = contentPoints.some(coveredAt)
    // `elementFromPoint` skips `pointer-events: none` elements, exactly how
    // fading loading overlays are styled — scan root-level layers for one.
    // Overlays mount as direct children of <body>; a deeper scan would cost a
    // full styled DOM walk on every poll for a marginal case.
    if (!covered && document.body) {
      const layers = document.body.children
      for (let i = 0; i < layers.length && !covered; i++) {
        const layer = layers[i]
        const style = window.getComputedStyle(layer)
        if (style.pointerEvents !== 'none') continue
        if (
          style.position !== 'fixed' &&
          style.position !== 'absolute' &&
          style.position !== 'sticky'
        ) {
          continue
        }
        if (contentPoints.some(point => layer.contains(point.el))) continue
        if (coversViewport(layer) && isOpaqueLayer(layer)) covered = true
      }
    }
  }

  return {
    height: root ? root.scrollHeight : 0,
    viewport: vh,
    images,
    decoded,
    painted,
    text,
    covered,
    fonts: !document.fonts || document.fonts.status === 'loaded',
    complete: document.readyState === 'complete'
  }
}

// 300ms of held quiet plus one 150ms poll to prove height stability puts the
// gate's floor at ~450ms. The hold guards against lulls (a page momentarily
// stable between async chunks); height stability + all images decoded +
// `readyState === 'complete'` carry most of the settle signal, so a longer
// hold buys little — below ~300ms it would start trusting coincidences.
const waitForReady = async (page, { timeout, quietMs = 300, poll = 150 } = {}) => {
  if (!Number.isFinite(timeout)) throw new TypeError('timeout must be a finite number')
  // The quiet window must fit within the budget with room to observe it, or the
  // gate could never satisfy its own requirement and would always time out.
  quietMs = Math.min(quietMs, Math.floor(timeout / 2))
  const deadline = Date.now() + timeout
  // Never sleep past the deadline: with a poll larger than the remaining
  // budget, a full-length sleep would overshoot the timeout and steal time
  // from whatever shares the caller's budget (the blank-SPA screenshot poll).
  const nextPoll = () => sleep(Math.min(poll, Math.max(0, deadline - Date.now())))
  let lastHeight = -1
  let quietSince = 0
  let resets = 0
  let last = {
    height: 0,
    viewport: 0,
    images: 0,
    decoded: 0,
    painted: 0,
    text: 0,
    covered: false,
    fonts: false,
    complete: false
  }

  while (Date.now() < deadline) {
    let signals
    try {
      signals = await page.evaluate(paintSignals)
    } catch (error) {
      // Only a client-side navigation tearing down the execution context is
      // absorbed: reset the quiet window and keep polling. Any other evaluate
      // failure is a real error and surfaces instead of masquerading as a
      // timeout.
      if (!isContextDestroyed(error)) throw error
      resets++
      lastHeight = -1
      quietSince = 0
      await nextPoll()
      continue
    }

    last = signals
    const imagesDecoded = signals.images === 0 || signals.decoded >= signals.images
    const quiet = signals.complete && imagesDecoded && signals.height === lastHeight

    if (quiet) {
      if (quietSince === 0) quietSince = Date.now()
      if (Date.now() - quietSince >= quietMs) return { ...signals, resets, timedOut: false }
    } else {
      quietSince = 0
      lastHeight = signals.height
    }

    await nextPoll()
  }

  return { ...last, resets, timedOut: true }
}

module.exports = { waitForReady, paintSignals }

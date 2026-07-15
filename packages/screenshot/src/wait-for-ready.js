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

// Evaluated in-page: a cheap snapshot of the paint/settle signals. `images`
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
// rely on), and `fonts` reports whether webfonts finished loading — during a
// `font-display: block` period text renders invisible, exactly when a capture
// would be white.
const snapshot = () => {
  const vw = window.innerWidth || document.documentElement.clientWidth
  const vh = window.innerHeight || document.documentElement.clientHeight
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
  }
  // Counting stops at 200 chars, so a text-heavy page costs a handful of nodes,
  // not a full DOM walk; only a near-blank shell walks every text node.
  let text = 0
  const walker = document.createTreeWalker(
    document.body || document.documentElement,
    window.NodeFilter.SHOW_TEXT
  )
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
    text += value.length
  }
  return {
    height: document.documentElement.scrollHeight,
    images,
    decoded,
    painted,
    text,
    fonts: !document.fonts || document.fonts.status === 'loaded',
    complete: document.readyState === 'complete'
  }
}

const waitForReady = async (page, { timeout, quietMs = 600, poll = 150 } = {}) => {
  if (!Number.isFinite(timeout)) throw new TypeError('timeout must be a finite number')
  // The quiet window must fit within the budget with room to observe it, or the
  // gate could never satisfy its own requirement and would always time out.
  quietMs = Math.min(quietMs, Math.floor(timeout / 2))
  const deadline = Date.now() + timeout
  let lastHeight = -1
  let quietSince = 0
  let resets = 0
  let last = {
    height: 0,
    images: 0,
    decoded: 0,
    painted: 0,
    text: 0,
    fonts: false,
    complete: false
  }

  while (Date.now() < deadline) {
    let snap
    try {
      snap = await page.evaluate(snapshot)
    } catch (error) {
      // Only a client-side navigation tearing down the execution context is
      // absorbed: reset the quiet window and keep polling. Any other evaluate
      // failure is a real error and surfaces instead of masquerading as a
      // timeout.
      if (!isContextDestroyed(error)) throw error
      resets++
      lastHeight = -1
      quietSince = 0
      await sleep(poll)
      continue
    }

    last = snap
    const imagesDecoded = snap.images === 0 || snap.decoded >= snap.images
    const quiet = snap.complete && imagesDecoded && snap.height === lastHeight

    if (quiet) {
      if (quietSince === 0) quietSince = Date.now()
      if (Date.now() - quietSince >= quietMs) return { ...snap, resets, timedOut: false }
    } else {
      quietSince = 0
      lastHeight = snap.height
    }

    await sleep(poll)
  }

  return { ...last, resets, timedOut: true }
}

module.exports = { waitForReady }

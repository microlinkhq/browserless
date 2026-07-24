'use strict'

const { setTimeout: sleep } = require('node:timers/promises')
const { isContextDestroyed } = require('@browserless/errors')

const DEFAULT_QUIET_MS = 300
const DEFAULT_POLL_MS = 150

const paintSignals = () => {
  const TEXT_PAINT_CAP = 200
  const MIN_PAINTED_AREA_PX = 256
  const LAZY_IMAGE_VIEWPORTS = 2
  const CONTENT_SAMPLE_LIMIT = 4

  const root = document.documentElement
  const vw = window.innerWidth || (root ? root.clientWidth : 0)
  const vh = window.innerHeight || (root ? root.clientHeight : 0)

  const parseColor = value => {
    const match = /rgba?\(([^)]+)\)/.exec(value || '')
    if (!match) return null
    const parts = match[1].split(',').map(parseFloat)
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length === 4 ? parts[3] : 1 }
  }

  const effectiveBackground = el => {
    for (let node = el; node; node = node.parentElement) {
      const color = parseColor(window.getComputedStyle(node).backgroundColor)
      if (color && color.a >= 0.99) return color
    }
    return { r: 255, g: 255, b: 255, a: 1 }
  }

  const sameColor = (a, b) =>
    Math.abs(a.r - b.r) < 10 && Math.abs(a.g - b.g) < 10 && Math.abs(a.b - b.b) < 10

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

  const contentPoints = []
  const samplePoint = (el, rect) => {
    if (contentPoints.length >= CONTENT_SAMPLE_LIMIT) return
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
      if (img.loading === 'lazy' && img.getBoundingClientRect().top > vh * LAZY_IMAGE_VIEWPORTS) {
        continue
      }
      images++
      continue
    }
    images++
    decoded++
    if (img.naturalWidth === 0) continue
    const rect = img.getBoundingClientRect()
    if (rect.width * rect.height < MIN_PAINTED_AREA_PX) continue
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

  let text = 0
  const textRoot = document.body || root
  const walker = textRoot
    ? document.createTreeWalker(textRoot, window.NodeFilter.SHOW_TEXT)
    : { nextNode: () => null }
  try {
    while (text < TEXT_PAINT_CAP) {
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
      const color = parseColor(window.getComputedStyle(el).color)
      if (color && (color.a < 0.05 || sameColor(color, effectiveBackground(el)))) continue
      text += value.length
      samplePoint(el, rect)
    }
  } catch {}

  const coveredAt = ({ el, x, y }) => {
    const top = document.elementFromPoint(x, y)
    if (!top) return false
    for (let node = top; node && node !== document.documentElement; node = node.parentElement) {
      if (node === el || node.contains(el) || el.contains(node)) return false
      if (coversViewport(node) && isOpaqueLayer(node)) return true
    }
    return false
  }

  let covered = false
  if (painted > 0 || text >= TEXT_PAINT_CAP) {
    covered = contentPoints.some(coveredAt)
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

const waitForReady = async (
  page,
  { timeout, quietMs = DEFAULT_QUIET_MS, poll = DEFAULT_POLL_MS } = {}
) => {
  if (!Number.isFinite(timeout)) throw new TypeError('timeout must be a finite number')
  quietMs = Math.min(quietMs, Math.floor(timeout / 2))
  const deadline = Date.now() + timeout
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

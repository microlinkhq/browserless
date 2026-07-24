'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const pReflect = require('p-reflect')

const { waitForDomStability } = require('./wait-for-dom')

// Per-step dwell for intersection-observer / lazy fetches. Kept as a fixed
// cap — scaling delay with the request budget made tall pages crawl (e.g.
// 20 steps × multi-second delays) without improving hydrate rate.
const SCROLL_STEP_MS = 250

// Wait until the tallest overflow scroller's height stops growing. App shells
// often mount lazy sections after chrome paints; scrolling before that walks a
// short scroller and never triggers below-fold fetches.
const waitForOverflowHeight = (page, timeout = 3000) =>
  page.evaluate(
    timeout =>
      new Promise(resolve => {
        const started = Date.now()
        let last = 0
        let stable = 0
        const tick = () => {
          const scroll = [...document.querySelectorAll('*')]
            .filter(el => {
              const s = window.getComputedStyle(el)
              return (
                (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
                el.scrollHeight > el.clientHeight + 200
              )
            })
            .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
          const height = scroll
            ? scroll.scrollHeight
            : (document.scrollingElement || document.documentElement).scrollHeight
          if (height === last && height > window.innerHeight + 200) {
            if (++stable >= 2) return resolve(height)
          } else {
            stable = 0
            last = height
          }
          if (Date.now() - started >= timeout) return resolve(height)
          setTimeout(tick, 200)
        }
        tick()
      }),
    timeout
  )

// App shells often keep content in an overflow scroller (`doc` ≈ viewport).
// `fullPage` screenshots and `page.pdf()` only see the document flow, so unwrap
// the tallest overflow root when it is taller than the viewport.
const expandOverflow = () => {
  const scroll = [...document.querySelectorAll('*')]
    .filter(el => {
      const s = window.getComputedStyle(el)
      return (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + 200
      )
    })
    .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]

  if (!scroll) return false

  let el = scroll
  while (el) {
    const pos = window.getComputedStyle(el).position
    el.style.setProperty('overflow', 'visible', 'important')
    el.style.setProperty('height', 'auto', 'important')
    el.style.setProperty('max-height', 'none', 'important')
    if (pos === 'absolute' || pos === 'fixed') {
      el.style.setProperty('position', 'relative', 'important')
      el.style.setProperty('inset', 'auto', 'important')
    }
    if (el === document.documentElement) break
    el = el.parentElement
  }
  return true
}

// Walk the page (window, or the tallest overflow scroller when the document
// itself isn't tall) so lazy sections and intersection-observer fetches run.
const scrollFullPageToLoadContent = async (page, timeout) => {
  const duration = debug.duration()
  const preQuiet = Math.min(300, Math.floor(timeout / 10))
  const postQuiet = Math.min(800, Math.floor(timeout / 6))
  const scrollBudget = Math.max(0, timeout - preQuiet - postQuiet)

  if (preQuiet > 0) {
    const result = await page.evaluate(waitForDomStability, {
      idle: preQuiet / 2,
      timeout: preQuiet
    })
    duration('waitForDomStability:pre', result)
  }

  await page.evaluate(
    (scrollBudget, stepMs) =>
      new Promise(resolve => {
        const doc = document.scrollingElement || document.documentElement
        let root = null
        let pageHeight = doc ? doc.scrollHeight : 0
        let viewport = window.innerHeight

        if (pageHeight <= viewport + 1 && document.body) {
          let best = null
          for (const el of document.body.querySelectorAll('*')) {
            if (el.scrollHeight <= el.clientHeight + 20) continue
            const { overflowY } = window.getComputedStyle(el)
            if (overflowY !== 'auto' && overflowY !== 'scroll') continue
            if (!best || el.scrollHeight > best.scrollHeight) best = el
          }
          if (best) {
            root = best
            pageHeight = best.scrollHeight
            viewport = best.clientHeight
          }
        }

        const started = Date.now()
        let currentScrollPosition = 0
        const scrollStep = Math.max(1, Math.floor(viewport * 0.85))
        const reset = () => {
          window.scrollTo(0, 0)
          if (root) root.scrollTop = 0
          resolve()
        }
        const scrollNext = () => {
          if (currentScrollPosition >= pageHeight || Date.now() - started >= scrollBudget) {
            return reset()
          }
          if (root) root.scrollBy(0, scrollStep)
          else window.scrollBy(0, scrollStep)
          currentScrollPosition += scrollStep
          setTimeout(scrollNext, stepMs)
        }
        scrollNext()
      }),
    scrollBudget,
    SCROLL_STEP_MS
  )

  if (postQuiet > 0) {
    const result = await page.evaluate(waitForDomStability, {
      idle: Math.min(200, postQuiet / 2),
      timeout: postQuiet
    })
    duration('waitForDomStability:post', result)
  }
}

// Shared by fullPage screenshot and PDF: after the page is ready, hydrate
// overflow content and unwrap it so capture sees the full document flow.
const resolveScrollTimeout = (goto, timeout) => {
  if (timeout != null) return timeout
  if (typeof goto?.timeouts?.goto === 'function') return goto.timeouts.goto()
  if (typeof goto?.timeouts?.action === 'function') return goto.timeouts.action()
  return 15000
}

const prepareFullDocument = async (page, { goto, timeout } = {}) => {
  const scrollTimeout = resolveScrollTimeout(goto, timeout)
  const elapsed = require('@kikobeats/time-span')({ format: n => Math.round(n) })()

  const height = await pReflect(
    waitForOverflowHeight(page, Math.min(3000, Math.round(scrollTimeout / 5)))
  )
  debug('prepareFullDocument:overflowHeight', {
    height: height.isRejected ? null : height.value,
    duration: elapsed()
  })

  await scrollFullPageToLoadContent(page, scrollTimeout)
  debug('prepareFullDocument:scroll', { duration: elapsed() })

  // Brief network settle for fetches the scroll triggered — keep this off
  // `goto.waitUntilAuto` so readiness-retry mocks stay countable.
  const settleMs = Math.min(1500, Math.max(0, scrollTimeout - elapsed()))
  if (settleMs > 0 && typeof page.waitForNetworkIdle === 'function') {
    await pReflect(page.waitForNetworkIdle({ idleTime: 300, concurrency: 2, timeout: settleMs }))
  }

  const expanded = await pReflect(page.evaluate(expandOverflow))
  debug('prepareFullDocument:expandOverflow', {
    expanded: !expanded.isRejected && expanded.value,
    duration: elapsed()
  })

  return { expanded: !expanded.isRejected && expanded.value, duration: elapsed() }
}

module.exports = {
  waitForOverflowHeight,
  expandOverflow,
  scrollFullPageToLoadContent,
  prepareFullDocument,
  SCROLL_STEP_MS
}

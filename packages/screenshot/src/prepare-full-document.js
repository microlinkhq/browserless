'use strict'

const debug = require('debug-logfmt')('browserless:prepare')
const pReflect = require('p-reflect')

const { waitForDomStability } = require('./wait-for-dom')

const SCROLL_STEP_MS = 50
const OVERFLOW_MIN_PX = 200
const OVERFLOW_WAIT_MS = 1500
const PRE_QUIET_MS = 50
const POST_QUIET_MS = 200
const SETTLE_MS = 400

const waitForOverflowHeight = (page, timeout = OVERFLOW_WAIT_MS) =>
  page.evaluate(
    (timeout, minPx) =>
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
                el.scrollHeight > el.clientHeight + minPx
              )
            })
            .sort((a, b) => b.scrollHeight - a.scrollHeight)[0]
          const height = scroll
            ? scroll.scrollHeight
            : (document.scrollingElement || document.documentElement).scrollHeight
          const tall = height > window.innerHeight + minPx
          if (height === last && tall) {
            if (++stable >= 2) return resolve(height)
          } else {
            stable = 0
            last = height
          }
          if (Date.now() - started >= timeout) return resolve(height)
          // Shell pages grow late — poll a bit slower until content appears.
          setTimeout(tick, tall ? 100 : 150)
        }
        tick()
      }),
    timeout,
    OVERFLOW_MIN_PX
  )

const expandOverflow = (minPx = 200) => {
  const scroll = [...document.querySelectorAll('*')]
    .filter(el => {
      const s = window.getComputedStyle(el)
      return (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        el.scrollHeight > el.clientHeight + minPx
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

const scrollFullPageToLoadContent = async (page, timeout) => {
  const preQuiet = Math.min(PRE_QUIET_MS, Math.floor(timeout / 20))
  const postQuiet = Math.min(POST_QUIET_MS, Math.floor(timeout / 20))
  const scrollBudget = Math.max(0, timeout - preQuiet - postQuiet)
  const started = Date.now()

  if (preQuiet > 0) {
    const result = await page.evaluate(waitForDomStability, {
      idle: preQuiet / 2,
      timeout: preQuiet
    })
    debug('waitForDomStability:pre', { ...result, duration: Date.now() - started })
  }

  const scroll = await page.evaluate(
    (scrollBudget, stepMs, minPx) =>
      new Promise(resolve => {
        const findOverflow = () => {
          if (!document.body) return null
          let best = null
          for (const el of document.body.querySelectorAll('*')) {
            if (el.scrollHeight <= el.clientHeight + minPx) continue
            const { overflowY } = window.getComputedStyle(el)
            if (overflowY !== 'auto' && overflowY !== 'scroll') continue
            if (!best || el.scrollHeight > best.scrollHeight) best = el
          }
          return best
        }

        const doc = () => document.scrollingElement || document.documentElement
        let root = null
        let pageHeight = doc() ? doc().scrollHeight : 0
        let viewport = window.innerHeight
        let currentScrollPosition = 0
        const scrollStarted = Date.now()

        const measure = () => {
          if (!root) {
            const overflow = findOverflow()
            if (overflow) root = overflow
          }
          if (root) {
            pageHeight = root.scrollHeight
            viewport = root.clientHeight || window.innerHeight
          } else {
            const el = doc()
            pageHeight = el ? el.scrollHeight : 0
            viewport = window.innerHeight
          }
        }

        const finish = () => {
          window.scrollTo(0, 0)
          if (root) root.scrollTop = 0
          resolve({
            hasOverflow: !!root,
            pageHeight,
            viewport,
            scrolledPx: currentScrollPosition,
            duration: Date.now() - scrollStarted
          })
        }

        const scrollNext = () => {
          measure()
          const step = Math.max(1, Math.floor(viewport * 0.95))
          if (currentScrollPosition >= pageHeight || Date.now() - scrollStarted >= scrollBudget) {
            return finish()
          }
          if (root) root.scrollBy(0, step)
          else window.scrollBy(0, step)
          currentScrollPosition += step
          setTimeout(scrollNext, stepMs)
        }

        measure()
        // Viewport-sized shell with no overflow yet: brief wait for the SPA
        // scroller before falling through to window scroll / budget exit.
        if (pageHeight <= viewport + 1 && !root) {
          const waitUntil = scrollStarted + Math.min(1000, Math.floor(scrollBudget / 4))
          const waitForRoot = () => {
            measure()
            if (root || Date.now() >= waitUntil) return scrollNext()
            setTimeout(waitForRoot, stepMs)
          }
          return waitForRoot()
        }
        scrollNext()
      }),
    scrollBudget,
    SCROLL_STEP_MS,
    OVERFLOW_MIN_PX
  )
  debug('scrollFullPage', { ...scroll, duration: Date.now() - started })

  if (postQuiet > 0) {
    const postStarted = Date.now()
    const result = await page.evaluate(waitForDomStability, {
      idle: Math.min(100, postQuiet / 2),
      timeout: postQuiet
    })
    debug('waitForDomStability:post', { ...result, duration: Date.now() - postStarted })
  }

  const hydrated = !!(scroll?.hasOverflow && scroll.scrolledPx >= (scroll.viewport || 0))
  return { ...scroll, hydrated, duration: Date.now() - started }
}

const resolveScrollTimeout = (goto, timeout) => {
  if (timeout != null) return timeout
  if (typeof goto?.timeouts?.goto === 'function') return goto.timeouts.goto()
  if (typeof goto?.timeouts?.action === 'function') return goto.timeouts.action()
  return 15000
}

const prepareFullDocument = async (page, { goto, timeout, scrolled = false } = {}) => {
  const scrollTimeout = resolveScrollTimeout(goto, timeout)
  const elapsed = require('@kikobeats/time-span')({ format: n => Math.round(n) })()

  if (!scrolled) {
    const height = await pReflect(
      waitForOverflowHeight(page, Math.min(OVERFLOW_WAIT_MS, Math.round(scrollTimeout / 8)))
    )
    debug('prepareFullDocument:overflowHeight', {
      height: height.isRejected ? null : height.value,
      duration: elapsed()
    })

    await scrollFullPageToLoadContent(page, scrollTimeout)
    debug('prepareFullDocument:scroll', { duration: elapsed() })
  } else {
    debug('prepareFullDocument:skipScroll', { duration: elapsed() })
  }

  const settleMs = Math.min(SETTLE_MS, Math.max(0, scrollTimeout - elapsed()))
  if (settleMs > 0 && typeof page.waitForNetworkIdle === 'function') {
    await pReflect(page.waitForNetworkIdle({ idleTime: 200, concurrency: 2, timeout: settleMs }))
  }

  const expanded = await pReflect(page.evaluate(expandOverflow, OVERFLOW_MIN_PX))
  debug('prepareFullDocument:expandOverflow', {
    expanded: !expanded.isRejected && expanded.value,
    duration: elapsed()
  })

  return { expanded: !expanded.isRejected && expanded.value, duration: elapsed(), scrolled }
}

module.exports = {
  waitForOverflowHeight,
  expandOverflow,
  scrollFullPageToLoadContent,
  prepareFullDocument,
  SCROLL_STEP_MS,
  OVERFLOW_MIN_PX
}

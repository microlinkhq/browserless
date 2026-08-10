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

// The single overflow scanner: the tallest whole-document element that scrolls
// its own overflow past minPx. Runs in the page.
function findTallestOverflowScroller (minPx) {
  let best = null
  for (const el of document.querySelectorAll('*')) {
    const style = window.getComputedStyle(el)
    if (style.overflowY !== 'auto' && style.overflowY !== 'scroll') continue
    if (el.scrollHeight <= el.clientHeight + minPx) continue
    if (!best || el.scrollHeight > best.scrollHeight) best = el
  }
  return best
}

// page.evaluate only serializes the function it is given, so an in-page helper
// can't be shared across evaluates by reference. Compose the scanner source in
// front of `fn` on the Node side (no in-page eval, so page CSP is untouched) to
// give every caller the same scanner.
const evaluateInPage = (page, fn, ...args) => {
  const source = `${findTallestOverflowScroller}\nreturn (${fn}).apply(null, arguments)`
  // eslint-disable-next-line no-new-func
  return page.evaluate(new Function(source), ...args)
}

const waitForOverflowHeight = (page, timeout = OVERFLOW_WAIT_MS) =>
  evaluateInPage(
    page,
    (timeout, minPx) =>
      new Promise(resolve => {
        const started = Date.now()
        let last = 0
        let stable = 0
        const tick = () => {
          const scroll = findTallestOverflowScroller(minPx)
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

const expandOverflow = (page, minPx = OVERFLOW_MIN_PX) =>
  evaluateInPage(
    page,
    minPx => {
      const scroll = findTallestOverflowScroller(minPx)
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
    },
    minPx
  )

const settleDom = async (page, { idle, timeout }, label) => {
  const started = Date.now()
  const result = await page.evaluate(waitForDomStability, { idle, timeout })
  debug(label, { ...result, duration: Date.now() - started })
}

const isCompleteScroll = scroll =>
  !!scroll?.hasOverflow &&
  Number(scroll.pageHeight) > 0 &&
  scroll.scrolledPx + (scroll.viewport || 0) >= scroll.pageHeight

const scrollFullPageToLoadContent = async (page, timeout) => {
  const preQuiet = Math.min(PRE_QUIET_MS, Math.floor(timeout / 20))
  const postQuiet = Math.min(POST_QUIET_MS, Math.floor(timeout / 20))
  const scrollBudget = Math.max(0, timeout - preQuiet - postQuiet)
  const started = Date.now()

  if (preQuiet > 0) {
    await settleDom(page, { idle: preQuiet / 2, timeout: preQuiet }, 'waitForDomStability:pre')
  }

  const scroll = await evaluateInPage(
    page,
    (scrollBudget, stepMs, minPx) =>
      new Promise(resolve => {
        const doc = () => document.scrollingElement || document.documentElement
        let root = null
        let pageHeight = doc() ? doc().scrollHeight : 0
        let viewport = window.innerHeight
        let currentScrollPosition = 0
        const scrollStarted = Date.now()

        const measure = () => {
          if (!root) {
            const overflow = findTallestOverflowScroller(minPx)
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
    await settleDom(
      page,
      { idle: Math.min(100, postQuiet / 2), timeout: postQuiet },
      'waitForDomStability:post'
    )
  }

  const hydrated = isCompleteScroll(scroll)
  return { ...scroll, hydrated, duration: Date.now() - started }
}

const resolveScrollTimeout = (goto, timeout) =>
  typeof goto.timeouts.goto === 'function'
    ? goto.timeouts.goto(timeout)
    : goto.timeouts.action(timeout)

// A hydrate scroll spends up to half the remaining budget (capped) scrolling,
// and the capture that follows still needs time. Below HYDRATE_MIN_BUDGET_MS
// there isn't enough left for both, so skip it.
const HYDRATE_MIN_BUDGET_MS = 1000
const HYDRATE_MAX_SCROLL_MS = 5000

const tryHydrateScroll = async (page, remaining) => {
  if (remaining <= HYDRATE_MIN_BUDGET_MS) return { hydrated: false, info: {} }
  const hydrate = await pReflect(
    scrollFullPageToLoadContent(page, Math.min(remaining / 2, HYDRATE_MAX_SCROLL_MS))
  )
  return {
    hydrated: !hydrate.isRejected && !!hydrate.value?.hydrated,
    info: hydrate.isRejected ? {} : hydrate.value
  }
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

    await pReflect(scrollFullPageToLoadContent(page, scrollTimeout))
    debug('prepareFullDocument:scroll', { duration: elapsed() })
  } else {
    debug('prepareFullDocument:skipScroll', { duration: elapsed() })
  }

  const settleMs = Math.min(SETTLE_MS, Math.max(0, scrollTimeout - elapsed()))
  if (settleMs > 0 && typeof page.waitForNetworkIdle === 'function') {
    await pReflect(page.waitForNetworkIdle({ idleTime: 200, concurrency: 2, timeout: settleMs }))
  }

  const expandResult = await pReflect(expandOverflow(page))
  const expanded = !expandResult.isRejected && expandResult.value
  debug('prepareFullDocument:expandOverflow', { expanded, duration: elapsed() })

  return { expanded, duration: elapsed(), scrolled }
}

module.exports = {
  expandOverflow,
  scrollFullPageToLoadContent,
  prepareFullDocument,
  resolveScrollTimeout,
  tryHydrateScroll,
  isCompleteScroll
}

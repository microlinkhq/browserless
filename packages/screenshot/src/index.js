'use strict'

const debug = require('debug-logfmt')('browserless:screenshot')
const createGoto = require('@browserless/goto')
const { extname } = require('node:path')
const pReflect = require('p-reflect')

const isTransientContextLoss = require('./is-transient-context-loss')
const isWhiteScreenshot = require('./is-white-screenshot')
const createSettle = require('./settle')
const { evaluateIsolated } = require('./evaluate-isolated')
const waitForPrism = require('./pretty')
const prettyTimeSpan = require('./time-span')
const overlay = require('./overlay')
const { waitForDomStability } = require('./wait-for-dom')
const {
  expandOverflow,
  scrollFullPageToLoadContent,
  prepareFullDocument,
  resolveScrollTimeout,
  tryHydrateScroll
} = require('./prepare-full-document')

const timeSpan = require('@kikobeats/time-span')()

const ELEMENT_CLIP_ATTEMPTS = 2

// No pacing here on purpose: `waitUntilAuto` is a network-idle wait, which on a
// live page costs at least its idle window (~500ms) and at most what is left of
// the budget. The runaway case was never a fast loop — it was retrying a page
// that was gone, where the wait returns instantly. Classify that and the loop
// paces itself on real work.
const captureWithNavigationRetry = async (capture, { page, goto, timeout }) => {
  const elapsed = timeSpan()
  const remaining = () => timeout - elapsed()
  while (true) {
    try {
      return await capture()
    } catch (error) {
      if (!isTransientContextLoss(page, error) || remaining() <= 0) throw error
      debug('captureWithNavigationRetry', { error: error.message })
      await goto.waitUntilAuto(page, { timeout: remaining(), credit: false })
      if (remaining() <= 0) throw error
    }
  }
}

const getPageMeta = page =>
  evaluateIsolated(page, () => ({
    title: document.title || '',
    bodyText: document.body ? document.body.innerText || '' : '',
    url: window.location.href || ''
  }))

const defaultIsPageReady = ({ isWhite }) => !isWhite

const checkPageReady = async (page, { isPageReady, response, screenshot, isWhite } = {}) => {
  let pageMeta = {}
  if (isPageReady !== defaultIsPageReady) {
    const pageMetaResult = await pReflect(getPageMeta(page))
    pageMeta = pageMetaResult.isRejected ? {} : pageMetaResult.value
  }
  const pageReadyResult = await pReflect(
    isPageReady({ page, response, screenshot, isWhite, isWhiteScreenshot, ...pageMeta })
  )
  return !pageReadyResult.isRejected && !!pageReadyResult.value
}

// One pass over on-screen images. A rendered bitmap fully inside the viewport
// is decoded so the shot does not land mid-decode. Chrome never settles that
// decode while the load is unfinished, so an image that draws nothing is left
// alone: an empty box, a `visibility: hidden` slide (including one hidden by an
// ancestor), or `content-visibility: hidden` on the image or an ancestor. A
// visible image that intersects the viewport and has not loaded is pending:
// the auto retry treats that as not ready. A finished broken image is not
// pending — waiting will not load it. Opacity is ignored so a fade-in hero
// still counts. Callers that only need the decode ignore the flag.
const waitForViewportImages = (page, { decode = true } = {}) =>
  evaluateIsolated(
    page,
    async shouldDecode => {
      const viewH = window.innerHeight || document.documentElement.clientHeight
      const viewW = window.innerWidth || document.documentElement.clientWidth
      const decodes = []
      let pending = false
      const rendered = el =>
        (typeof el.checkVisibility !== 'function' ||
          el.checkVisibility({ visibilityProperty: true })) &&
        window.getComputedStyle(el).contentVisibility !== 'hidden'

      for (const el of document.querySelectorAll('img:not([aria-hidden="true"])')) {
        const { top, left, bottom, right, width, height } = el.getBoundingClientRect()
        const hasPixels = el.naturalWidth > 0 && el.naturalHeight > 0

        if (
          shouldDecode &&
          hasPixels &&
          width > 0 &&
          height > 0 &&
          top >= 0 &&
          left >= 0 &&
          bottom <= viewH &&
          right <= viewW &&
          rendered(el)
        ) {
          decodes.push(el.decode())
        }

        if (pending || width < 32 || height < 32) continue
        if (bottom <= 0 || right <= 0 || top >= viewH || left >= viewW) continue
        if (!rendered(el)) continue

        const src = el.currentSrc || el.getAttribute('src') || ''
        const lazy =
          el.getAttribute('data-src') ||
          el.getAttribute('data-srcset') ||
          el.getAttribute('data-lazy-src')
        if ((src === '' || src.startsWith('data:')) && lazy) pending = true
        else if (!hasPixels && !el.complete) pending = true
      }

      // A rejected decode must not hide a sibling that is still pending.
      if (shouldDecode) await Promise.all(decodes).catch(() => {})
      return pending
    },
    decode
  )

// A timed-out decode rejects the whole call. Re-read the flag without waiting,
// so a skeleton is still not ready.
const pendingViewportImages = async (page, goto, timeout) => {
  if (timeout <= 0) return false
  const settled = await goto.run({
    fn: waitForViewportImages(page),
    timeout,
    debug: 'screenshot:waitForViewportImages'
  })
  const probe = settled.isRejected
    ? await pReflect(waitForViewportImages(page, { decode: false }))
    : settled
  return !probe.isRejected && !!probe.value
}

// Two frames is enough for the scroll listeners. A hidden page can stop
// delivering frames entirely, so the gesture must still restore and resolve.
const NUDGE_FRAME_MS = 100

/**
 * One viewport of scroll and back, so an intersection observer on a hero
 * requests its asset before the readiness check. The document is stretched
 * for the gesture when the page itself does not overflow. The scroll is
 * instant: `scroll-behavior: smooth` must not leave the shot mid-animation.
 *
 * @param {import('puppeteer').Page} page
 * @returns {Promise<void>}
 */
const nudgeViewport = page =>
  evaluateIsolated(
    page,
    timeoutMs =>
      new Promise(resolve => {
        const root = document.scrollingElement || document.documentElement
        const behaviorNode = document.documentElement
        const previousHeight = root.style.height
        const previousBehavior = behaviorNode.style.scrollBehavior
        const x = window.scrollX
        const y = window.scrollY
        let settled = false
        const scrollTo = (left, top) => window.scrollTo({ left, top, behavior: 'instant' })

        const finish = () => {
          if (settled) return
          settled = true
          // Height first: scrolling while the root is still the temporary
          // three-viewport height clamps a saved position below that range.
          root.style.height = previousHeight
          scrollTo(x, y)
          behaviorNode.style.scrollBehavior = previousBehavior
          resolve()
        }

        try {
          behaviorNode.style.scrollBehavior = 'auto'
          root.style.height = `${(window.innerHeight || 800) * 3}px`
          scrollTo(0, window.innerHeight || 800)
          const timer = window.setTimeout(finish, timeoutMs)
          window.requestAnimationFrame(() => {
            scrollTo(x, y)
            window.requestAnimationFrame(() => {
              window.clearTimeout(timer)
              finish()
            })
          })
        } catch {
          finish()
        }
      }),
    NUDGE_FRAME_MS
  )

const readElementClip = async (page, element) => {
  const handle = await page.waitForSelector(element, { visible: true })
  try {
    return await handle.boundingBox()
  } finally {
    await handle.dispose()
  }
}

const waitForElement = async (page, element, captureOpts) => {
  for (let attempt = 0; attempt < ELEMENT_CLIP_ATTEMPTS; attempt++) {
    captureOpts.clip = await readElementClip(page, element)
    if (captureOpts.clip !== null) break
  }
  captureOpts.fullPage = false
}

const SCREENSHOT_DEFAULT_OPTS = {
  codeScheme: 'atom-dark',
  overlay: {},
  waitUntil: 'auto',
  isPageReady: defaultIsPageReady
}

const LOSSY_TYPES = new Set(['jpeg', 'webp'])
const LOSSY_EXTENSIONS = new Set(['.jpg', '.jpeg', '.webp'])

const isLossy = ({ type, path }) =>
  type !== undefined
    ? LOSSY_TYPES.has(type)
    : LOSSY_EXTENSIONS.has(extname(path ?? '').toLowerCase())

// PNG of a ~150 megapixel full page encodes past the free-plan browser budget
// (wuling.com/carDetail, 30k CSS px at 2x: ~9s locally, still open at 28s in
// production). JPEG of that surface comes back empty from Chrome. Scale the
// clip so the PNG stays within this many device pixels.
const FULL_PAGE_PNG_PIXELS = 40000000

const fullPageScreenshotOpts = async (page, screenshotOpts) => {
  if (!screenshotOpts.fullPage || screenshotOpts.clip) return screenshotOpts
  const size = await pReflect(
    evaluateIsolated(page, () => ({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight
    }))
  )
  if (size.isRejected || size.value == null) return screenshotOpts
  const { width, height } = size.value
  if (!(width > 0) || !(height > 0)) return screenshotOpts
  const dpr = page.viewport()?.deviceScaleFactor || 1
  const pixels = Math.ceil(width * dpr) * Math.ceil(height * dpr)
  if (pixels <= FULL_PAGE_PNG_PIXELS) return screenshotOpts
  return {
    ...screenshotOpts,
    captureBeyondViewport: true,
    fullPage: false,
    clip: {
      height,
      scale: Math.sqrt(FULL_PAGE_PNG_PIXELS / pixels),
      width,
      x: 0,
      y: 0
    }
  }
}

// Captures stay binary until returned: the blank-page check and the overlay
// decode them with sharp, which reads a base64 string as raw bytes.
const encodeScreenshot = (image, encoding) => {
  if (!ArrayBuffer.isView(image)) return image
  const buffer = Buffer.from(image.buffer, image.byteOffset, image.byteLength)
  return encoding === 'base64' ? buffer.toString('base64') : buffer
}

const viewportProbe = opts => {
  if (!opts.fullPage) return opts
  const { fullPage, path, quality, ...probeOpts } = opts
  return { ...probeOpts, fullPage: false }
}

const actionTimeout = ({ stepTimeout }) => stepTimeout

const createPrepare = goto => {
  const beforeCapture = async (page, response, opts, timeout) => {
    const { codeScheme, element, fullPage = false } = opts
    const captureOpts = {}
    const tasks = [
      {
        fn: () => evaluateIsolated(page, 'document.fonts.ready'),
        debug: 'beforeScreenshot:fontsReady'
      },
      {
        fn: () => waitForViewportImages(page),
        debug: 'beforeScreenshot:waitForViewportImages'
      }
    ]

    if (codeScheme && response) {
      tasks.push({
        fn: () => waitForPrism(page, response, opts),
        debug: 'beforeScreenshot:waitForPrism'
      })
    }

    if (element && !fullPage) {
      tasks.push({
        fn: () => waitForElement(page, element, captureOpts),
        debug: 'beforeScreenshot:waitForElement'
      })
    }

    await Promise.all(tasks.map(({ fn, ...task }) => goto.run({ fn: fn(), ...task, timeout })))

    if (captureOpts.clip === null) {
      throw new Error(`Element \`${element}\` detached before its clip could be read`)
    }

    return captureOpts
  }

  const waitForReadyCapture = async (
    page,
    opts,
    { response, isPageReady, probe, timeout, stepTimeout }
  ) => {
    const elapsed = timeSpan()
    const probeOpts = probe(opts)
    let screenshot
    let retry = 0
    let isWhite = false
    let isReady = false
    let scrolled = false
    let didHydrateAttempt = false

    await pReflect(nudgeViewport(page))

    do {
      const waitsForImages = elapsed() < stepTimeout
      const pending =
        waitsForImages &&
        (await pendingViewportImages(page, goto, Math.min(stepTimeout, timeout) - elapsed()))

      screenshot = await captureWithNavigationRetry(() => page.screenshot(probeOpts), {
        page,
        goto,
        timeout: stepTimeout
      })
      isWhite = await isWhiteScreenshot(screenshot)
      isReady = await checkPageReady(page, { isPageReady, response, screenshot, isWhite })

      if (isReady && pending) isReady = false

      if (isReady || elapsed() >= timeout) break

      const remaining = timeout - elapsed()
      if (opts.fullPage && !didHydrateAttempt) {
        didHydrateAttempt = true
        const { hydrated, info } = await tryHydrateScroll(page, remaining)
        scrolled = hydrated
        debug('screenshot:hydrateScroll', { remaining, hydrated, ...info })
      }

      const idleTimeout = timeout - elapsed()
      if (idleTimeout <= 0) break

      retry += 1
      await goto.waitUntilAuto(page, { timeout: idleTimeout, credit: false })
    } while (!isReady)

    return { screenshot, isWhite, isReady, retry, scrolled }
  }

  return async (
    page,
    url,
    {
      waitUntil,
      isPageReady = defaultIsPageReady,
      probe = viewportProbe,
      readyTimeout = actionTimeout,
      codeScheme,
      ...opts
    }
  ) => {
    const stepTimeout = goto.timeouts.action(opts.timeout)
    const duration = prettyTimeSpan()

    if (waitUntil !== 'auto') {
      const { response } = await goto(page, { ...opts, url, waitUntil })
      const captureOpts = await beforeCapture(page, response, { ...opts, codeScheme }, stepTimeout)
      if (opts.fullPage) await prepareFullDocument(page, { goto, timeout: opts.timeout })
      debug('prepare', { waitUntil, duration: duration() })
      return { response, captureOpts, isReady: true }
    }

    let prepared = { isReady: false }
    const settler = createSettle(page)
    try {
      await goto(page, {
        ...opts,
        url,
        waitUntil,
        waitUntilAuto: async (page, { response, timeout } = {}) => {
          const budget = readyTimeout({ timeout, stepTimeout })
          const elapsed = timeSpan()
          const remaining = () => Math.max(stepTimeout, budget - elapsed())
          await settler.wait({ timeout: budget })
          const captureOpts = await beforeCapture(
            page,
            response,
            { ...opts, codeScheme },
            stepTimeout
          )
          const ready = await waitForReadyCapture(
            page,
            { ...opts, ...captureOpts },
            { response, isPageReady, probe, timeout: remaining(), stepTimeout }
          )
          prepared = { response, captureOpts, ...ready }
        }
      })
    } finally {
      await settler.stop()
    }

    if (opts.fullPage && prepared.isReady) {
      await prepareFullDocument(page, {
        goto,
        timeout: opts.timeout,
        scrolled: prepared.scrolled && !opts.flattenShadowDOM
      })
    }

    const { isReady, isWhite, retry } = prepared
    debug('prepare', { waitUntil, isReady, isWhite, retry, duration: duration() })
    return prepared
  }
}

const dismissDialogs = async (page, fn) => {
  const onDialog = dialog => pReflect(dialog.dismiss())
  page.on('dialog', onDialog)
  try {
    return await fn()
  } finally {
    page.off('dialog', onDialog)
  }
}

module.exports = ({ goto, ...gotoOpts }) => {
  goto = goto || createGoto(gotoOpts)
  const prepare = createPrepare(goto)

  return function screenshot (page) {
    return async (
      url,
      {
        codeScheme = SCREENSHOT_DEFAULT_OPTS.codeScheme,
        overlay: overlayOpts = SCREENSHOT_DEFAULT_OPTS.overlay,
        waitUntil = SCREENSHOT_DEFAULT_OPTS.waitUntil,
        isPageReady = SCREENSHOT_DEFAULT_OPTS.isPageReady,
        encoding,
        ...opts
      } = {}
    ) => {
      if (opts.quality !== undefined && !isLossy(opts)) opts.quality = undefined

      const captureExpanded = (expand, screenshotOpts, timeout) =>
        captureWithNavigationRetry(
          async () => {
            if (expand) await pReflect(expandOverflow(page))
            return page.screenshot(await fullPageScreenshotOpts(page, screenshotOpts))
          },
          { page, goto, timeout }
        )

      return dismissDialogs(page, async () => {
        const {
          captureOpts,
          isReady,
          screenshot: probe
        } = await prepare(page, url, {
          ...opts,
          codeScheme,
          waitUntil,
          isPageReady
        })

        let screenshot = probe
        if (waitUntil !== 'auto') {
          screenshot = await captureExpanded(
            opts.fullPage,
            { ...opts, ...captureOpts },
            goto.timeouts.action(opts.timeout)
          )
        } else if (opts.fullPage) {
          screenshot = await captureExpanded(
            isReady,
            { ...opts, fullPage: true },
            resolveScrollTimeout(goto, opts.timeout)
          )
        }

        const image =
          Object.keys(overlayOpts).length === 0
            ? screenshot
            : await overlay(screenshot, { ...opts, ...overlayOpts, viewport: page.viewport() })
        return encodeScreenshot(image, encoding)
      })
    }
  }
}

module.exports.createPrepare = createPrepare
module.exports.dismissDialogs = dismissDialogs
module.exports.captureWithNavigationRetry = captureWithNavigationRetry
module.exports.isWhiteScreenshot = isWhiteScreenshot
module.exports.waitForDomStability = waitForDomStability
module.exports.scrollFullPageToLoadContent = scrollFullPageToLoadContent
module.exports.expandOverflow = expandOverflow
module.exports.getPageMeta = getPageMeta
module.exports.checkPageReady = checkPageReady
module.exports.tryHydrateScroll = tryHydrateScroll
module.exports.resolveScrollTimeout = resolveScrollTimeout
module.exports.prepareFullDocument = prepareFullDocument
module.exports.SCREENSHOT_DEFAULT_OPTS = SCREENSHOT_DEFAULT_OPTS

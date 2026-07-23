'use strict'

const { waitForDomStability } = require('@browserless/screenshot')
const createPdf = require('@browserless/pdf')
const path = require('path')
const fs = require('fs')
const test = require('ava')

const whiteScreenshot = fs.readFileSync(
  path.resolve(__dirname, '../../screenshot/test/fixtures/white-5k.png')
)

const noWhiteScreenshot = fs.readFileSync(
  path.resolve(__dirname, '../../screenshot/test/fixtures/no-white-5k.png')
)

// `waitUntilAuto` runs two in-page evaluates: `waitForDomStability` and
// `paintSignals`. Dispatch on function identity — the workspace resolves both
// packages to the same module instance — so the stub keeps routing correctly
// even if either evaluate's signature changes.
const scriptEvaluate = (signals, onDomStability) => async (fn, args) => {
  if (fn === waitForDomStability) {
    onDomStability(args)
    return { status: 'idle' }
  }
  return signals
}

const IMAGELESS_READY = {
  height: 800,
  viewport: 720,
  images: 0,
  decoded: 0,
  painted: 0,
  text: 0,
  covered: false,
  fonts: true,
  complete: true
}
const PAINTED_READY = {
  height: 2000,
  viewport: 720,
  images: 3,
  decoded: 3,
  painted: 3,
  text: 0,
  covered: false,
  fonts: true,
  complete: true
}
// A blank shell: an image decoded (e.g. a tracking pixel) but nothing visibly
// painted, in a document taller than the viewport.
const PIXEL_ONLY_READY = {
  height: 2000,
  viewport: 720,
  images: 1,
  decoded: 1,
  painted: 0,
  text: 0,
  covered: false,
  fonts: true,
  complete: true
}
// A text-only article: no images, but enough visible text in the viewport with
// webfonts loaded — painted content without a single <img>.
const TEXT_READY = {
  height: 2000,
  viewport: 720,
  images: 0,
  decoded: 0,
  painted: 0,
  text: 200,
  covered: false,
  fonts: true,
  complete: true
}
// Same text, but a webfont still loading: during `font-display: block` the
// text renders invisible, so it must not count as painted.
const FONT_PENDING_READY = { ...TEXT_READY, fonts: false }
// Same painted signals, but the content hides behind an opaque fixed overlay
// (a loading screen): a capture would be white despite the DOM signals.
const COVERED_TEXT_READY = { ...TEXT_READY, covered: true }
const COVERED_PAINTED_READY = { ...PAINTED_READY, covered: true }

// A `goto` stub that just runs the `waitUntilAuto` hook and reports an action
// timeout. `onWaitUntilAuto` observes the blank-SPA re-wait `prepare` triggers.
const makeGoto = ({ action = 100000, onWaitUntilAuto } = {}) => {
  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }
  goto.timeouts = {
    action: () => action,
    goto: (ms = action) => Math.round(ms * (7 / 8))
  }
  goto.waitUntilAuto = async () => onWaitUntilAuto && onWaitUntilAuto()
  return goto
}

test('waitUntil auto should generate final pdf once', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0
  let waitUntilAutoCalls = 0
  const domStabilityCalls = []

  const page = {
    screenshot: async () => (screenshotCalls++ === 0 ? whiteScreenshot : noWhiteScreenshot),
    evaluate: scriptEvaluate(IMAGELESS_READY, args => domStabilityCalls.push(args)),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from(`pdf-${pdfCalls}`)
    }
  }

  const goto = makeGoto({ onWaitUntilAuto: () => (waitUntilAutoCalls += 1) })

  const pdf = createPdf({ goto })(page)
  const buffer = await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  t.true(Buffer.isBuffer(buffer))
  t.is(pdfCalls, 1)
  t.true(screenshotCalls >= 2)
  t.is(waitUntilAutoCalls, 1)
  // Default waitForDom is off; only prepareFullDocument's scroll quiet may call it.
  t.false(domStabilityCalls.some(args => args && args.timeout === 2500))
})

test('waitUntil auto should honor custom waitForDom', async t => {
  const domStabilityCalls = []

  const page = {
    screenshot: async () => noWhiteScreenshot,
    evaluate: scriptEvaluate(IMAGELESS_READY, args => domStabilityCalls.push(args)),
    pdf: async () => Buffer.from('pdf')
  }

  const goto = makeGoto()

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', waitForDom: 2500, timeout: 500 })

  t.true(domStabilityCalls.some(args => args && args.timeout === 2500 && args.idle === 250))
})

test('retries pdf generation when navigation destroys the execution context', async t => {
  let pdfCalls = 0
  let waitUntilAutoCalls = 0

  const page = {
    screenshot: async () => noWhiteScreenshot,
    evaluate: scriptEvaluate(IMAGELESS_READY, () => {}),
    pdf: async () => {
      if (pdfCalls++ === 0) {
        throw new Error('Execution context was destroyed, most likely because of a navigation.')
      }
      return Buffer.from('pdf-ok')
    }
  }

  const goto = makeGoto({ onWaitUntilAuto: () => (waitUntilAutoCalls += 1) })

  const pdf = createPdf({ goto })(page)
  const buffer = await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  t.deepEqual(buffer, Buffer.from('pdf-ok'))
  t.is(pdfCalls, 2)
  t.is(waitUntilAutoCalls, 1)
})

test('waitUntil auto skips the screenshot poll for painted content', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0

  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      return whiteScreenshot
    },
    evaluate: scriptEvaluate(PAINTED_READY, () => {}),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = makeGoto()

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  // Painted, uncovered content: the poll never runs, zero captures.
  t.is(screenshotCalls, 0)
  t.is(pdfCalls, 1)
})

test('waitUntil auto: a decoded tracking pixel does not trip the painted fast path', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0

  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      return noWhiteScreenshot
    },
    evaluate: scriptEvaluate(PIXEL_ONLY_READY, () => {}),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = makeGoto()

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  // Fast path skipped: the white-screen check still runs even though an image
  // decoded, because nothing was visibly painted.
  t.is(screenshotCalls, 1)
  t.is(pdfCalls, 1)
})

test('waitUntil auto: a timed-out gate does not take the painted fast path', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0
  let height = 1000

  // Never settles (height keeps growing), so the gate times out while still
  // reporting painted content. The fast path must be skipped and the poll run.
  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      return noWhiteScreenshot
    },
    evaluate: async fn => {
      if (fn === waitForDomStability) return { status: 'idle' }
      return {
        height: (height += 100),
        viewport: 720,
        images: 3,
        decoded: 3,
        painted: 3,
        complete: true
      }
    },
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = makeGoto({ action: 300 })

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 300 })

  t.true(screenshotCalls >= 1)
  t.is(pdfCalls, 1)
})

test('the capture retry budget is the remaining action budget, not a fresh one', async t => {
  let height = 1000

  // Worst case on both stages: the gate never settles (eats its half of the
  // budget), then every capture races a navigation. The retry loop must give
  // up when the SHARED budget is spent — handing it a fresh full timeout
  // would let prepare run ~1.5x the action budget (gate half + full retry).
  const page = {
    screenshot: async () => {
      throw new Error('Execution context was destroyed, most likely because of a navigation.')
    },
    evaluate: async fn => {
      if (fn === waitForDomStability) return { status: 'idle' }
      return {
        height: (height += 100),
        viewport: 720,
        images: 0,
        decoded: 0,
        painted: 0,
        text: 0,
        fonts: true,
        complete: true
      }
    },
    pdf: async () => Buffer.from('pdf')
  }

  const goto = makeGoto({ action: 2000 })

  const pdf = createPdf({ goto })(page)
  const start = Date.now()
  await t.throwsAsync(() => pdf('https://example.com', { waitUntil: 'auto', timeout: 2000 }), {
    message: /Execution context was destroyed/
  })
  // gate ~1000ms + retries bounded by the remaining ~1000ms ≈ 2000ms total;
  // a fresh per-capture budget would push this to ~3000ms.
  t.true(Date.now() - start < 2600)
})

test('waitUntil auto skips the screenshot poll for visible text', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0

  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      return whiteScreenshot
    },
    evaluate: scriptEvaluate(TEXT_READY, () => {}),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = makeGoto()

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  t.is(screenshotCalls, 0)
  t.is(pdfCalls, 1)
})

test('waitUntil auto: text under an opaque overlay does not skip the blank check', async t => {
  let screenshotCalls = 0
  let waitUntilAutoCalls = 0

  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      // The overlay keeps the first poll capture white; then content shows.
      if (screenshotCalls === 1) return whiteScreenshot
      return noWhiteScreenshot
    },
    evaluate: scriptEvaluate(COVERED_TEXT_READY, () => {}),
    pdf: async () => Buffer.from('pdf')
  }

  const goto = makeGoto({ onWaitUntilAuto: () => (waitUntilAutoCalls += 1) })

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  // The gate sees 200+ chars of text, but it is covered: the fast path must
  // fall through to the poll and re-wait until the capture is non-white.
  t.is(screenshotCalls, 2)
  t.is(waitUntilAutoCalls, 1)
})

test('waitUntil auto: painted images under an opaque overlay do not skip the blank check', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0

  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      return noWhiteScreenshot
    },
    evaluate: scriptEvaluate(COVERED_PAINTED_READY, () => {}),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = makeGoto()

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  // Covered content skips the fast path; the poll runs and exits on the first
  // non-white capture (the overlay may legitimately be an interstitial).
  t.is(screenshotCalls, 1)
  t.is(pdfCalls, 1)
})

test('waitUntil auto: text behind a loading webfont does not trip the fast path', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0

  const page = {
    screenshot: async () => {
      screenshotCalls += 1
      return noWhiteScreenshot
    },
    evaluate: scriptEvaluate(FONT_PENDING_READY, () => {}),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = makeGoto()

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  // The text is there but invisible while the font blocks: the white-screen
  // check must still run.
  t.is(screenshotCalls, 1)
  t.is(pdfCalls, 1)
})

'use strict'

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

// `waitUntilAuto` runs two in-page evaluates: `waitForDomStability` (invoked
// with an options arg) and the readiness `snapshot` (invoked with none). This
// helper answers the first by recording its arg, and the second with a scripted
// paint snapshot. `imageless` (no decoded images) keeps `waitForReady` off its
// fast path so the white-screen poll still runs.
const scriptEvaluate = (snapshot, onDomStability) => async (_fn, args) => {
  if (args !== undefined) {
    onDomStability(args)
    return { status: 'idle' }
  }
  return snapshot
}

const IMAGELESS_READY = { height: 800, images: 0, decoded: 0, painted: 0, complete: true }
const PAINTED_READY = { height: 2000, images: 3, decoded: 3, painted: 3, complete: true }
// A blank shell: an image decoded (e.g. a tracking pixel) but nothing visibly
// painted, in a document taller than the viewport.
const PIXEL_ONLY_READY = { height: 2000, images: 1, decoded: 1, painted: 0, complete: true }
const viewport = () => ({ width: 1280, height: 720 })

test('waitUntil auto should generate final pdf once', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0
  let waitUntilAutoCalls = 0
  let domStabilityArgs

  const page = {
    viewport,
    screenshot: async () => (screenshotCalls++ === 0 ? whiteScreenshot : noWhiteScreenshot),
    evaluate: scriptEvaluate(IMAGELESS_READY, args => (domStabilityArgs = args)),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from(`pdf-${pdfCalls}`)
    }
  }

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = {
    action: () => 100000
  }

  goto.waitUntilAuto = async () => {
    waitUntilAutoCalls += 1
  }

  const pdf = createPdf({ goto })(page)
  const buffer = await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  t.true(Buffer.isBuffer(buffer))
  t.is(pdfCalls, 1)
  t.true(screenshotCalls >= 2)
  t.is(waitUntilAutoCalls, 1)
  t.is(domStabilityArgs, undefined)
})

test('waitUntil auto should honor custom waitForDom', async t => {
  let domStabilityArgs

  const page = {
    viewport,
    screenshot: async () => noWhiteScreenshot,
    evaluate: scriptEvaluate(IMAGELESS_READY, args => (domStabilityArgs = args)),
    pdf: async () => Buffer.from('pdf')
  }

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = {
    action: () => 100000
  }

  goto.waitUntilAuto = async () => {}

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', waitForDom: 2500, timeout: 500 })

  t.deepEqual(domStabilityArgs, { timeout: 2500, idle: 250 })
})

test('retries pdf generation when navigation destroys the execution context', async t => {
  let pdfCalls = 0
  let waitUntilAutoCalls = 0

  const page = {
    viewport,
    screenshot: async () => noWhiteScreenshot,
    evaluate: scriptEvaluate(IMAGELESS_READY, () => {}),
    pdf: async () => {
      if (pdfCalls++ === 0) {
        throw new Error('Execution context was destroyed, most likely because of a navigation.')
      }
      return Buffer.from('pdf-ok')
    }
  }

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = { action: () => 100000 }
  goto.waitUntilAuto = async () => {
    waitUntilAutoCalls += 1
  }

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
    viewport,
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

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = { action: () => 100000 }
  goto.waitUntilAuto = async () => {}

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  t.is(screenshotCalls, 0)
  t.is(pdfCalls, 1)
})

test('waitUntil auto: a decoded tracking pixel does not trip the painted fast path', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0

  const page = {
    viewport,
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

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = { action: () => 100000 }
  goto.waitUntilAuto = async () => {}

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
    viewport,
    screenshot: async () => {
      screenshotCalls += 1
      return noWhiteScreenshot
    },
    evaluate: async (_fn, args) => {
      if (args !== undefined) return { status: 'idle' }
      return { height: (height += 100), images: 3, decoded: 3, painted: 3, complete: true }
    },
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from('pdf')
    }
  }

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = { action: () => 300 }
  goto.waitUntilAuto = async () => {}

  const pdf = createPdf({ goto })(page)
  await pdf('https://example.com', { waitUntil: 'auto', timeout: 300 })

  t.true(screenshotCalls >= 1)
  t.is(pdfCalls, 1)
})

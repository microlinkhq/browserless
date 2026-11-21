'use strict'

const { stubSettle, SETTLED } = require('../../screenshot/test/helpers/settled-stub')

const { runServer, getBrowserContext } = require('@browserless/test')
const { waitForDomStability } = require('@browserless/screenshot')
const createPdf = require('@browserless/pdf')
const path = require('path')
const fs = require('fs')
const { default: test } = require('ava')

const whiteScreenshot = fs.readFileSync(
  path.resolve(__dirname, '../../screenshot/test/fixtures/white-5k.png')
)

const noWhiteScreenshot = fs.readFileSync(
  path.resolve(__dirname, '../../screenshot/test/fixtures/no-white-5k.png')
)

const CONTEXT_DESTROYED = 'Execution context was destroyed, most likely because of a navigation.'

const createPage = ({ screenshot = async () => noWhiteScreenshot, pdf, onDomStability } = {}) => {
  const listeners = new Map()
  return {
    isClosed: () => false,
    on: (event, fn) => listeners.set(event, fn),
    off: (event, fn) => listeners.get(event) === fn && listeners.delete(event),
    listeners,
    evaluate: async (fn, args) => {
      if (fn === waitForDomStability) {
        if (onDomStability) onDomStability(args)
        return { status: 'idle' }
      }
      return undefined
    },
    screenshot,
    pdf: pdf || (async () => Buffer.from('pdf'))
  }
}

const createGoto = ({ action = 500, loadTimeout, onWaitUntilAuto } = {}) => {
  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page, { response: {}, timeout: loadTimeout })
    return { response: {} }
  }
  goto.run = async ({ fn, timeout }) => {
    let timer
    const expired = new Promise((resolve, reject) => {
      if (timeout) timer = setTimeout(() => reject(new Error('Promise timed out')), timeout)
    })
    return Promise.race([fn, expired])
      .then(
        value => ({ isRejected: false, value }),
        reason => ({ isRejected: true, reason })
      )
      .finally(() => clearTimeout(timer))
  }
  goto.timeouts = {
    action: () => action,
    goto: (ms = action) => Math.round(ms * (7 / 8))
  }
  goto.waitUntilAuto = async (page, opts) => onWaitUntilAuto && onWaitUntilAuto(opts)
  return goto
}

test('waitUntil auto re-waits a white page and prints the final pdf once', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0
  const waits = []

  const page = createPage({
    screenshot: async () => (screenshotCalls++ === 0 ? whiteScreenshot : noWhiteScreenshot),
    pdf: async () => Buffer.from(`pdf-${++pdfCalls}`)
  })
  const goto = createGoto({ onWaitUntilAuto: opts => waits.push(opts) })

  const buffer = await createPdf({ goto })(page)('https://example.com', { timeout: 500 })

  t.deepEqual(buffer, Buffer.from('pdf-1'))
  t.is(screenshotCalls, 2)
  t.is(waits.length, 1)
  t.true(waits.every(opts => opts.credit === false))
})

test('the readiness probe is a cheap viewport capture, not the full document', async t => {
  const probes = []
  const page = createPage({
    screenshot: async opts => {
      probes.push(opts)
      return noWhiteScreenshot
    }
  })

  await createPdf({ goto: createGoto() })(page)('https://example.com', { timeout: 500 })

  t.deepEqual(probes, [{ optimizeForSpeed: true, type: 'jpeg', quality: 30 }])
})

test('a ready page is scrolled as a full document before printing', async t => {
  const order = []
  const page = createPage({
    onDomStability: () => order.push('scroll'),
    pdf: async () => {
      order.push('pdf')
      return Buffer.from('pdf')
    }
  })

  await createPdf({ goto: createGoto() })(page)('https://example.com', { timeout: 500 })

  t.true(order.includes('scroll'))
  t.is(order[order.length - 1], 'pdf')
})

test('retries pdf generation when navigation destroys the execution context', async t => {
  let pdfCalls = 0
  const waits = []
  const page = createPage({
    pdf: async () => {
      if (pdfCalls++ === 0) throw new Error(CONTEXT_DESTROYED)
      return Buffer.from('pdf-ok')
    }
  })
  const goto = createGoto({ onWaitUntilAuto: opts => waits.push(opts) })

  const buffer = await createPdf({ goto })(page)('https://example.com', { timeout: 500 })

  t.deepEqual(buffer, Buffer.from('pdf-ok'))
  t.is(pdfCalls, 2)
  t.is(waits.length, 1)
})

test('a probe that keeps racing a navigation gives up within the action budget', async t => {
  const page = createPage({
    screenshot: async () => {
      throw new Error(CONTEXT_DESTROYED)
    }
  })
  const goto = createGoto({ action: 1000 })

  const start = Date.now()
  await t.throwsAsync(createPdf({ goto })(page)('https://example.com', { timeout: 1000 }), {
    message: /Execution context was destroyed/
  })
  t.true(Date.now() - start < 1600)
})

test('dialogs are dismissed while preparing and printing, then released', async t => {
  let dismissed = 0
  const dialog = { dismiss: async () => dismissed++ }
  const page = createPage()
  page.screenshot = async () => {
    page.listeners.get('dialog')(dialog)
    return noWhiteScreenshot
  }
  page.pdf = async () => {
    page.listeners.get('dialog')(dialog)
    return Buffer.from('pdf')
  }

  await createPdf({ goto: createGoto() })(page)('https://example.com', { timeout: 500 })

  t.is(dismissed, 2)
  t.false(page.listeners.has('dialog'))
})

test('a page that finishes rendering after load is printed finished', async t => {
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(`<!DOCTYPE html>
<html>
<body style="margin:0;font:16px sans-serif">
  <main id="main" aria-busy="true">
    <div class="skeleton" style="height:400px;margin:24px;background:#e5e5e5;border-radius:8px"></div>
  </main>
  <div style="height:2000px"></div>
  <script>
    window.addEventListener('load', () => setTimeout(() => {
      const main = document.getElementById('main')
      main.removeAttribute('aria-busy')
      main.innerHTML = '<article><h1>Finished article</h1><p>The content the reader came for.</p></article>'
    }, 800))
  </script>
</body>
</html>`)
  })

  const browserless = await getBrowserContext(t)
  const page = await browserless.page()
  t.teardown(() => page.close())

  let printedText
  const pdf = page.pdf.bind(page)
  page.pdf = async opts => {
    printedText = await page.evaluate(() => document.body.innerText)
    return pdf(opts)
  }

  const buffer = await createPdf({ goto: browserless.goto })(page)(url, { timeout: 15000 })

  t.true(buffer.length > 0)
  t.true(printedText.includes('Finished article'))
})

test.serial(
  'pdf readiness is budgeted by the load timeout goto hands to waitUntilAuto',
  async t => {
    const settleTimeouts = []
    const original = stubSettle.wait
    stubSettle.wait = async ({ timeout }) => {
      settleTimeouts.push(timeout)
      return SETTLED
    }
    t.teardown(() => {
      stubSettle.wait = original
    })

    const goto = createGoto({ action: 300, loadTimeout: 20000 })
    await createPdf({ goto })(createPage())('https://example.com', { timeout: 300 })

    t.deepEqual(settleTimeouts, [20000])
  }
)

test('an on-screen image that never decodes holds a pdf for the step budget, not the load budget', async t => {
  const page = createPage()
  page.evaluate = async (fn, shouldDecode) => {
    if (fn === waitForDomStability) return { status: 'idle' }
    if (String(fn).includes('decode()') && shouldDecode) return new Promise(() => {})
    return undefined
  }
  const goto = createGoto({ action: 300, loadTimeout: 20000 })

  const start = Date.now()
  await createPdf({ goto })(page)('https://example.com', { timeout: 300 })

  t.true(Date.now() - start < 2000)
})

test('a navigation on the probe after a full idle wait still prints the pdf', async t => {
  let probes = 0
  const page = createPage({
    screenshot: async () => {
      probes += 1
      if (probes === 1) return whiteScreenshot
      if (probes === 2) throw new Error(CONTEXT_DESTROYED)
      return noWhiteScreenshot
    }
  })
  const goto = createGoto({ action: 1500 })
  let idleWaits = 0
  goto.waitUntilAuto = async (page, { timeout }) => {
    if (idleWaits++ === 0) await new Promise(resolve => setTimeout(resolve, timeout))
  }

  const buffer = await createPdf({ goto })(page)('https://example.com', { timeout: 1500 })

  t.deepEqual(buffer, Buffer.from('pdf'))
  t.is(probes, 3)
})

test('the full document is scrolled after goto returns, where the shadow DOM is flattened', async t => {
  const order = []
  const page = createPage({ onDomStability: () => order.push('scroll') })
  const goto = createGoto()
  const gotoWithFlatten = async (page, opts) => {
    const result = await goto(page, opts)
    order.push('flatten')
    return result
  }
  Object.assign(gotoWithFlatten, goto)

  await createPdf({ goto: gotoWithFlatten })(page)('https://example.com', { timeout: 500 })

  t.is(order[0], 'flatten')
  t.true(order.includes('scroll'))
})

test('screenshot re-exports every helper pdf imports from it', t => {
  const screenshot = require('@browserless/screenshot')
  const source = fs.readFileSync(require.resolve('@browserless/pdf'), 'utf8')
  const block = source.match(/const\s*\{([^}]*)\}\s*=\s*require\('@browserless\/screenshot'\)/)
  t.truthy(block, 'pdf must import from @browserless/screenshot')
  const names = block[1]
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
  const missing = names.filter(name => screenshot[name] === undefined)
  t.deepEqual(missing, [], `missing screenshot re-exports: ${missing.join(', ')}`)
})

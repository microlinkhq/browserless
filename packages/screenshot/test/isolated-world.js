'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const test = require('ava')

const createScreenshot = require('..')
const { waitForReady } = require('..')

const hooks = `
(() => {
  const calls = (window.__automationCalls = [])
  const record = name => {
    const frames = (new Error().stack || '').split('\\n').slice(3)
    if (frames.length && !frames.some(frame => frame.includes(location.origin))) calls.push(name)
  }
  const hookMethod = (target, name) => {
    const original = target[name]
    target[name] = function (...args) {
      record(name)
      return original.apply(this, args)
    }
  }
  const hookGetter = (target, name) => {
    let owner = target
    while (!Object.getOwnPropertyDescriptor(owner, name)) owner = Object.getPrototypeOf(owner)
    const descriptor = Object.getOwnPropertyDescriptor(owner, name)
    Object.defineProperty(owner, name, {
      ...descriptor,
      get () {
        record(name)
        return descriptor.get.call(this)
      }
    })
  }
  hookMethod(Document.prototype, 'querySelectorAll')
  hookMethod(window, 'getComputedStyle')
  hookMethod(window, 'scrollBy')
  hookMethod(window, 'requestAnimationFrame')
  hookMethod(Element.prototype, 'getBoundingClientRect')
  hookMethod(Document.prototype, 'elementFromPoint')
  hookGetter(window, 'innerHeight')
  hookGetter(Document.prototype, 'fonts')
  hookGetter(Document.prototype, 'title')
  hookGetter(HTMLElement.prototype, 'innerText')
})()
`

const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC'

const html = `<!doctype html><html><head><title>hooked</title><script>${hooks}</script></head>
<body style="margin:0"><h1 id="title">hooked</h1><p>${'lorem ipsum '.repeat(40)}</p>
<img src="${PIXEL}" width="300" height="300"><div style="height:3000px"></div></body></html>`

const serve = t =>
  runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })

const automationCalls = (browserless, url, capture) =>
  browserless.withPage((page, goto) => async () => {
    await capture({ page, goto, url })
    const calls = await page.evaluate(() => window.__automationCalls)
    await page.close()
    return calls
  })()

const screenshotWith =
  opts =>
    ({ page, goto, url }) =>
      createScreenshot({ goto })(page)(url, { adblock: false, codeScheme: false, ...opts })

test('viewport screenshot helpers are invisible to page hooks', async t => {
  const browserless = await getBrowserContext(t)
  t.deepEqual(await automationCalls(browserless, await serve(t), screenshotWith({})), [])
})

test('fullPage screenshot helpers are invisible to page hooks', async t => {
  const browserless = await getBrowserContext(t)
  const capture = screenshotWith({ fullPage: true })
  t.deepEqual(await automationCalls(browserless, await serve(t), capture), [])
})

test('element screenshot helpers are invisible to page hooks', async t => {
  const browserless = await getBrowserContext(t)
  const capture = screenshotWith({ element: '#title' })
  t.deepEqual(await automationCalls(browserless, await serve(t), capture), [])
})

test('isPageReady page metadata is read invisibly to page hooks', async t => {
  const browserless = await getBrowserContext(t)
  const capture = screenshotWith({ isPageReady: ({ title }) => title === 'hooked' })
  t.deepEqual(await automationCalls(browserless, await serve(t), capture), [])
})

test('waitForReady paint signals are invisible to page hooks', async t => {
  const browserless = await getBrowserContext(t)
  const capture = async ({ page, goto, url }) => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    const signals = await waitForReady(page, { timeout: 3000, quietMs: 100, poll: 50 })
    t.true(signals.text >= 200)
  }
  t.deepEqual(await automationCalls(browserless, await serve(t), capture), [])
})

test('an isolated world observes DOM mutations made by the page', async t => {
  const { evaluateIsolated } = require('../src/evaluate-isolated')
  const { waitForDomStability } = require('..')
  const browserless = await getBrowserContext(t)
  const url = await serve(t)

  const status = await browserless.withPage((page, goto) => async () => {
    await goto(page, { url, waitUntil: 'load', adblock: false })
    await page.evaluate(() => {
      const timer = setInterval(() => document.body.appendChild(document.createElement('i')), 20)
      setTimeout(() => clearInterval(timer), 400)
    })
    const busy = await evaluateIsolated(page, waitForDomStability, { idle: 150, timeout: 200 })
    const settled = await evaluateIsolated(page, waitForDomStability, { idle: 150, timeout: 2000 })
    await page.close()
    return { busy: busy.status, settled: settled.status }
  })()

  t.deepEqual(status, { busy: 'timeout', settled: 'idle' })
})

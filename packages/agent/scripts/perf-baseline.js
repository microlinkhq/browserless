'use strict'

const { createServer } = require('node:http')
const puppeteer = require('puppeteer')

const snapshot = require('../src/snapshot')
const pageOutline = require('../src/outline')
const { evaluateRules } = require('../src/rules')
const { buildRequest } = require('../src/model')

const OUTLINE_LIMITS = { characters: 60000, text: 80, attribute: 80, siblings: 3 }
const WARMUP = 5
const ITERATIONS = 30
const RULES = {
  title: { selector: 'h1,h2', attr: 'text', type: 'string' },
  links: { selectorAll: 'a[href]', attr: 'href', type: 'url' }
}

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

const summarize = values => {
  const digits = value => Math.round(value * 100) / 100
  return {
    n: values.length,
    p50: digits(percentile(values, 0.5)),
    p95: digits(percentile(values, 0.95)),
    p99: digits(percentile(values, 0.99))
  }
}

const listings = () => {
  const cards = Array.from({ length: 80 }, (_, index) => {
    const price = 12000 + index * 137
    return `<article class="card">
      <a href="/item/${index}"><h2>BMW X3 ${2018 + (index % 8)} ${index}</h2></a>
      <p class="price">${price} €</p>
      <p>${'Leather seats, navigation, service history. '.repeat(6)}</p>
      <button type="button">Save ${index}</button>
    </article>`
  }).join('')
  return `<!doctype html><html><head><title>Listings</title></head><body>
    <form><input aria-label="Search"><button type="submit">Search</button></form>
    <main>${cards}</main></body></html>`
}

const grid = () => {
  const cells = Array.from(
    { length: 400 },
    (_, index) =>
      `<a href="/i/${index}"><span>Item ${index} bmw</span></a><button type="button">Item ${index} bmw</button>`
  ).join('')
  return `<!doctype html><html><head><title>Grid</title>
    <style>body{margin:0;font:11px/1.1 sans-serif}#grid{display:flex;flex-wrap:wrap}a,button{width:90px;height:18px}</style>
    </head><body><div id="grid">${cells}</div></body></html>`
}

const longDocument = () => {
  const blocks = Array.from(
    { length: 2000 },
    (_, index) =>
      `<p>Paragraph ${index}. ${'The quick brown fox jumps over the lazy dog. '.repeat(
        4
      )} <a href="/p/${index}">link ${index}</a></p>`
  ).join('')
  return `<!doctype html><html><head><title>Long</title></head><body>
    <input aria-label="Search"><button>Go</button>${blocks}</body></html>`
}

const listen = pages =>
  new Promise(resolve => {
    const server = createServer((request, response) => {
      const name = request.url.slice(1) || 'listings'
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(pages[name] || pages.listings)
    })
    server.listen(0, '127.0.0.1', () => resolve(server))
  })

const time = async (page, fn, arg) => {
  const samples = []
  for (let index = 0; index < WARMUP + ITERATIONS; index++) {
    const ms = await page.evaluate(
      (body, payload) => {
        const started = performance.now()
        body(payload)
        return performance.now() - started
      },
      fn,
      arg
    )
    if (index >= WARMUP) samples.push(ms)
  }
  return samples
}

const measure = async page => {
  const counts = await page.evaluate(() => ({
    elements: document.querySelectorAll('*').length
  }))
  const roundTrip = []
  for (let index = 0; index < WARMUP + ITERATIONS; index++) {
    const started = performance.now()
    const state = await page.evaluate(snapshot)
    if (index >= WARMUP) roundTrip.push({ ms: performance.now() - started, state })
  }
  const state = roundTrip[0].state
  return {
    elements: counts.elements,
    actions: state.actions.length,
    textChars: state.text.length,
    snapshotBytes: Buffer.byteLength(JSON.stringify(state)),
    guardsBytes: Buffer.byteLength(JSON.stringify(state.guards)),
    snapshotInPageMs: summarize(await time(page, snapshot)),
    snapshotRoundTripMs: summarize(roundTrip.map(sample => sample.ms)),
    outlineMs: summarize(await time(page, pageOutline, OUTLINE_LIMITS)),
    rulesMs: summarize(await time(page, evaluateRules, RULES)),
    buildRequestMs: summarize(
      (() => {
        const samples = []
        const goal = 'busca el bmw x3 más barato'
        for (let index = 0; index < WARMUP; index++) buildRequest(state, goal, [])
        for (let index = 0; index < ITERATIONS; index++) {
          const started = performance.now()
          buildRequest(state, goal, [])
          samples.push(performance.now() - started)
        }
        return samples
      })()
    )
  }
}

const main = async () => {
  const pages = { listings: listings(), grid: grid(), long: longDocument() }
  const server = await listen(pages)
  const { port } = server.address()
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 800 })
  const report = {}
  for (const name of Object.keys(pages)) {
    await page.goto(`http://127.0.0.1:${port}/${name}`, { waitUntil: 'load' })
    report[name] = await measure(page)
  }
  for (const url of ['https://news.ycombinator.com', 'https://en.wikipedia.org/wiki/Alan_Turing']) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 })
      report[url] = await measure(page)
    } catch (error) {
      report[url] = { error: error.message }
    }
  }
  console.log(JSON.stringify(report, null, 2))
  await browser.close()
  server.close()
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})

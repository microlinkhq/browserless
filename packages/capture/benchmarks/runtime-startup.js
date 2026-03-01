'use strict'

const { performance } = require('perf_hooks')
const puppeteer = require('puppeteer')
const createCapture = require('..')

const ITERATIONS = Number(process.env.ITERATIONS || 12)
const WARMUP = Number(process.env.WARMUP || 2)
const DURATION = Number(process.env.DURATION || 400)
const CAPTURE_TIMEOUT = Number(process.env.CAPTURE_TIMEOUT || Math.max(DURATION * 3, 30000))
const RETRIES = Number(process.env.RETRIES || 2)
const URL = process.env.URL || 'https://example.com'

const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

const summarize = values => {
  const total = values.reduce((acc, value) => acc + value, 0)
  return {
    n: values.length,
    total,
    avg: total / values.length,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99)
  }
}

const toMs = value => Number(value.toFixed(2))

const runScenario = async ({ browser, iterations, warmup, duration, url }) => {
  const capture = createCapture({ goto: async (page, opts) => page.goto(opts.url, opts) })
  const samples = []

  for (let i = 0; i < warmup + iterations; i++) {
    let elapsed

    for (let attempt = 0; attempt <= RETRIES; attempt++) {
      const page = await browser.newPage()
      const startedAt = performance.now()

      try {
        await capture(page)(url, {
          duration,
          audio: false,
          video: true,
          timeout: CAPTURE_TIMEOUT,
          waitUntil: 'domcontentloaded'
        })
        elapsed = performance.now() - startedAt
        await page.close()
        break
      } catch (error) {
        await page.close().catch(() => {})
        const isNoData =
          error &&
          typeof error.message === 'string' &&
          error.message.includes('No video data was captured')
        if (!isNoData || attempt === RETRIES) throw error
      }
    }

    if (i >= warmup) samples.push(elapsed)
  }

  return summarize(samples)
}

const printSummary = (name, stats) => {
  console.log(
    [
      `${name}:`,
      `n=${stats.n}`,
      `avg=${toMs(stats.avg)}ms`,
      `p50=${toMs(stats.p50)}ms`,
      `p95=${toMs(stats.p95)}ms`,
      `p99=${toMs(stats.p99)}ms`,
      `total=${toMs(stats.total)}ms`
    ].join(' ')
  )
}

const main = async () => {
  console.log(
    `runtime benchmark: iterations=${ITERATIONS}, warmup=${WARMUP}, duration=${DURATION}ms, timeout=${CAPTURE_TIMEOUT}ms, retries=${RETRIES}`
  )

  const browser = await puppeteer.launch({
    headless: 'new',
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [
      `--allowlisted-extension-id=${createCapture.extensionId}`,
      `--disable-extensions-except=${createCapture.extensionPath}`,
      `--load-extension=${createCapture.extensionPath}`
    ]
  })

  try {
    console.log('running mode=mv3-service-worker')
    const mv3Mode = await runScenario({
      browser,
      iterations: ITERATIONS,
      warmup: WARMUP,
      duration: DURATION,
      url: URL
    })

    printSummary('mv3-service-worker', mv3Mode)
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

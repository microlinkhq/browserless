'use strict'

const { performance } = require('perf_hooks')
const createBrowser = require('../../browserless/src')

const ITERATIONS = Number(process.env.ITERATIONS || 12)
const WARMUP = Number(process.env.WARMUP || 2)
const DURATION = Number(process.env.DURATION || 400)
const CONCURRENCY = Number(process.env.CONCURRENCY || 4)
const CAPTURE_TIMEOUT = Number(process.env.CAPTURE_TIMEOUT || Math.max(DURATION * 3, 30000))
const RETRIES = Number(process.env.RETRIES || 2)
const URL = process.env.URL || 'https://example.com'

const percentile = (values, p) => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[index]
}

const summarize = (values, { opsPerSample = 1 } = {}) => {
  const total = values.reduce((acc, value) => acc + value, 0)
  const sampleCount = values.length
  const ops = sampleCount * opsPerSample
  const throughput = total > 0 ? (ops * 1000) / total : 0

  return {
    n: sampleCount,
    ops,
    total,
    avg: total / sampleCount,
    avgPerOp: total / ops,
    throughput,
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99)
  }
}

const toMs = value => Number(value.toFixed(2))

const runCapture = async ({ browserless, duration, url }) => {
  for (let attempt = 0; attempt <= RETRIES; attempt++) {
    const startedAt = performance.now()

    try {
      await browserless.capture(url, {
        duration,
        audio: false,
        video: true,
        waitUntil: 'domcontentloaded'
      })
      return performance.now() - startedAt
    } catch (error) {
      const isNoData =
        error &&
        typeof error.message === 'string' &&
        error.message.includes('No video data was captured')
      if (!isNoData || attempt === RETRIES) throw error
    }
  }
}

const runSequentialScenario = async ({ browserless, iterations, warmup, duration, url }) => {
  const samples = []

  for (let i = 0; i < warmup + iterations; i++) {
    const elapsed = await runCapture({ browserless, duration, url })
    if (i >= warmup) samples.push(elapsed)
  }

  return summarize(samples, { opsPerSample: 1 })
}

const runConcurrentScenario = async ({
  browserless,
  iterations,
  warmup,
  duration,
  url,
  concurrency
}) => {
  const samples = []

  for (let i = 0; i < warmup + iterations; i++) {
    const startedAt = performance.now()
    await Promise.all(
      Array.from({ length: concurrency }, () => runCapture({ browserless, duration, url }))
    )
    const elapsed = performance.now() - startedAt

    if (i >= warmup) samples.push(elapsed)
  }

  return summarize(samples, { opsPerSample: concurrency })
}

const printSummary = (name, stats) => {
  console.log(
    [
      `${name}:`,
      `n=${stats.n}`,
      `ops=${stats.ops}`,
      `avg=${toMs(stats.avg)}ms`,
      `avg/op=${toMs(stats.avgPerOp)}ms`,
      `p50=${toMs(stats.p50)}ms`,
      `p95=${toMs(stats.p95)}ms`,
      `p99=${toMs(stats.p99)}ms`,
      `throughput=${toMs(stats.throughput)}ops/s`,
      `total=${toMs(stats.total)}ms`
    ].join(' ')
  )
}

const main = async () => {
  console.log(
    `runtime benchmark: iterations=${ITERATIONS}, warmup=${WARMUP}, duration=${DURATION}ms, timeout=${CAPTURE_TIMEOUT}ms, retries=${RETRIES}, concurrency=${CONCURRENCY}`
  )

  const browser = createBrowser({
    headless: 'new',
    timeout: CAPTURE_TIMEOUT
  })
  const browserless = await browser.createContext()

  try {
    console.log('running mode=mv3-service-worker (sequential)')
    const mv3Sequential = await runSequentialScenario({
      browserless,
      iterations: ITERATIONS,
      warmup: WARMUP,
      duration: DURATION,
      url: URL
    })
    printSummary('mv3-service-worker-sequential', mv3Sequential)

    if (CONCURRENCY > 1) {
      console.log(`running mode=mv3-service-worker (concurrent, ${CONCURRENCY} captures/batch)`)
      const mv3Concurrent = await runConcurrentScenario({
        browserless,
        iterations: ITERATIONS,
        warmup: WARMUP,
        duration: DURATION,
        url: URL,
        concurrency: CONCURRENCY
      })
      printSummary(`mv3-service-worker-concurrent-${CONCURRENCY}x`, mv3Concurrent)
    }
  } finally {
    await browserless.destroyContext({ force: true }).catch(() => {})
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

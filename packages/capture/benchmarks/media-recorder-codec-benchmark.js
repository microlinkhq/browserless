'use strict'

const fs = require('node:fs/promises')
const path = require('node:path')

const createBrowser = require('../../browserless/src')
const { VIDEO_BITS_PER_SECOND_BY_QUALITY } = require('../src/constants')

const { defaultArgs } = createBrowser.driver

const QUALITY = process.env.QUALITY || 'extra-high'
const BITRATE = VIDEO_BITS_PER_SECOND_BY_QUALITY[QUALITY]

const ITERATIONS = Number(process.env.ITERATIONS || 3)
const DURATION_MS = Number(process.env.DURATION_MS || 3000)
const WARMUP_MS = Number(process.env.WARMUP_MS || 2000)
const FRAME_RATE = Number(process.env.FRAME_RATE || 60)
const WIDTH = Number(process.env.WIDTH || 1280)
const HEIGHT = Number(process.env.HEIGHT || 720)
const URL = process.env.URL || 'https://family.co/'
const SAVE_DIR = process.env.SAVE_DIR || path.resolve(process.cwd(), 'artifacts/mediabench')

const CANDIDATES = Object.freeze([
  'video/webm',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm;codecs=av1',
  'video/mp4',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4;codecs=avc1.4D401F',
  'video/mp4;codecs=avc1.640028',
  'video/mp4;codecs=hvc1'
])

const toFixed = (value, digits = 2) => Number(value.toFixed(digits))
const average = values =>
  values.length === 0 ? 0 : values.reduce((a, v) => a + v, 0) / values.length

const safeName = s =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')

const mimeToExt = mimeType => {
  if (/mp4/i.test(mimeType)) return 'mp4'
  if (/webm/i.test(mimeType)) return 'webm'
  return 'bin'
}

const ensureDir = async dir => {
  await fs.mkdir(dir, { recursive: true })
  return dir
}

const writeRecording = async ({ dir, mimeType, iteration, buffer }) => {
  const ext = mimeToExt(mimeType)
  const filename = `${safeName(mimeType)}__${iteration}.${ext}`
  const filepath = path.join(dir, filename)
  await fs.writeFile(filepath, buffer)
  return { filename, filepath }
}

// --- CDP metrics sampling (CPU + memory-ish) -------------------------------

const startCdpSampling = async (page, sampleEveryMs = 250) => {
  const client = await page.target().createCDPSession()
  await client.send('Performance.enable')

  let timer = null
  const perf = [] // CDP "Performance.getMetrics"
  const jsHeap = [] // performance.memory (Chrome only)

  const sample = async () => {
    try {
      const { metrics } = await client.send('Performance.getMetrics')
      perf.push({ t: Date.now(), metrics })

      const heap = await page.evaluate(() => {
        // not available everywhere
        const m = globalThis.performance && performance.memory
        if (!m) return null
        return {
          usedJSHeapSize: m.usedJSHeapSize,
          totalJSHeapSize: m.totalJSHeapSize,
          jsHeapSizeLimit: m.jsHeapSizeLimit
        }
      })
      if (heap) jsHeap.push({ t: Date.now(), ...heap })
    } catch {
      // ignore intermittent errors during navigation/teardown
    }
  }

  timer = setInterval(sample, sampleEveryMs)
  await sample()

  const stop = async () => {
    if (timer) clearInterval(timer)
    await sample()
    await client.send('Performance.disable').catch(() => {})
    await client.detach().catch(() => {})

    // Extract a few useful CDP metrics by name:
    // (Chrome provides these commonly: TaskDuration, ScriptDuration, LayoutDuration, RecalcStyleDuration, etc.)
    const pickMetric = (entry, name) => entry.metrics.find(m => m.name === name)?.value

    const series = perf.map(p => ({
      t: p.t,
      TaskDuration: pickMetric(p, 'TaskDuration'),
      ScriptDuration: pickMetric(p, 'ScriptDuration'),
      LayoutDuration: pickMetric(p, 'LayoutDuration'),
      RecalcStyleDuration: pickMetric(p, 'RecalcStyleDuration'),
      JSHeapUsedSize: pickMetric(p, 'JSHeapUsedSize'),
      JSHeapTotalSize: pickMetric(p, 'JSHeapTotalSize')
    }))

    // Aggregate deltas over the sampling window (approx “time spent”)
    const first = series[0] || {}
    const last = series[series.length - 1] || {}

    const delta = k =>
      typeof first[k] === 'number' && typeof last[k] === 'number' ? last[k] - first[k] : null

    const cdpSummary = {
      samples: series.length,
      taskMs: delta('TaskDuration') != null ? delta('TaskDuration') * 1000 : null,
      scriptMs: delta('ScriptDuration') != null ? delta('ScriptDuration') * 1000 : null,
      layoutMs: delta('LayoutDuration') != null ? delta('LayoutDuration') * 1000 : null,
      recalcStyleMs:
        delta('RecalcStyleDuration') != null ? delta('RecalcStyleDuration') * 1000 : null,
      heapUsedDeltaBytes: delta('JSHeapUsedSize') != null ? delta('JSHeapUsedSize') : null,
      heapTotalDeltaBytes: delta('JSHeapTotalSize') != null ? delta('JSHeapTotalSize') : null
    }

    // From performance.memory (more “real” JS heap values, but Chrome-only)
    const heapFirst = jsHeap[0]
    const heapLast = jsHeap[jsHeap.length - 1]
    const memSummary =
      heapFirst && heapLast
        ? {
            usedDeltaBytes: heapLast.usedJSHeapSize - heapFirst.usedJSHeapSize,
            usedMaxBytes: Math.max(...jsHeap.map(h => h.usedJSHeapSize)),
            usedAvgBytes: average(jsHeap.map(h => h.usedJSHeapSize))
          }
        : null

    return { cdpSummary, memSummary }
  }

  return { stop }
}

// --- in-page recorder (returns bytes + base64 for saving) -------------------

const runOne = async ({ page, mimeType, iteration, saveDir }) =>
  page.evaluate(
    async ({ mimeType, bitrate, warmupMs, durationMs, frameRate, width, height, wantBase64 }) => {
      const MediaRecorderClass = globalThis.MediaRecorder

      if (
        typeof MediaRecorderClass === 'undefined' ||
        typeof MediaRecorderClass.isTypeSupported !== 'function'
      ) {
        return { ok: false, error: 'MediaRecorder API is unavailable' }
      }

      if (!MediaRecorderClass.isTypeSupported(mimeType)) {
        return { ok: false, unsupported: true, error: `Unsupported mimeType: ${mimeType}` }
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return { ok: false, error: 'Canvas 2D context unavailable' }

      const stream = canvas.captureStream(frameRate)

      let rafId = 0
      let framesDrawn = 0

      const draw = () => {
        framesDrawn++
        const hue = framesDrawn % 360
        ctx.fillStyle = `hsl(${hue} 70% 45%)`
        ctx.fillRect(0, 0, width, height)
        ctx.fillStyle = '#fff'
        ctx.font = '24px sans-serif'
        ctx.fillText(`${mimeType}`, 24, 40)
        ctx.fillText(`${bitrate}bps @ ${frameRate}fps`, 24, 76)
        rafId = window.requestAnimationFrame(draw)
      }

      // Event loop lag (p95)
      const lagSamples = []
      let lastTick = performance.now()
      const lagInterval = setInterval(() => {
        const now = performance.now()
        lagSamples.push(Math.max(0, now - lastTick - 50))
        lastTick = now
      }, 50)

      const recordOnce = async ms => {
        const chunks = []
        const recorder = new MediaRecorderClass(stream, { mimeType, videoBitsPerSecond: bitrate })

        const stopped = new Promise((resolve, reject) => {
          recorder.onstop = resolve
          recorder.onerror = e => reject(new Error(e?.error?.message || 'MediaRecorder error'))
        })

        recorder.ondataavailable = e => {
          if (e.data && e.data.size) chunks.push(e.data)
        }

        recorder.start(250)
        await new Promise(resolve => setTimeout(resolve, ms))
        recorder.stop()
        await stopped

        const blob = new Blob(chunks, { type: mimeType })
        const bytes = blob.size

        let base64 = null
        if (wantBase64) {
          const buf = await blob.arrayBuffer()
          // Convert to base64 without btoa huge string risk:
          // (still potentially heavy for long clips; fine for a few seconds)
          const u8 = new Uint8Array(buf)
          let binary = ''
          const chunk = 0x8000
          for (let i = 0; i < u8.length; i += chunk) {
            binary += String.fromCharCode(...u8.subarray(i, i + chunk))
          }
          base64 = btoa(binary)
        }

        return { bytes, base64 }
      }

      try {
        draw()

        // Warmup (discard)
        await recordOnce(warmupMs)

        // Real measurement
        framesDrawn = 0
        const startedAt = performance.now()

        const { bytes, base64 } = await recordOnce(durationMs)
        const elapsedMs = performance.now() - startedAt

        window.cancelAnimationFrame(rafId)
        clearInterval(lagInterval)
        stream.getTracks().forEach(t => t.stop())

        const effectiveVideoBps = Math.round((bytes * 8) / (durationMs / 1000))
        const avgFpsDrawn = framesDrawn / (durationMs / 1000)

        lagSamples.sort((a, b) => a - b)
        const p95LagMs = lagSamples[Math.floor(lagSamples.length * 0.95)] || 0

        return {
          ok: true,
          bytes,
          elapsedMs,
          effectiveVideoBps,
          avgFpsDrawn,
          p95LagMs,
          base64 // may be null if not requested
        }
      } catch (error) {
        window.cancelAnimationFrame(rafId)
        clearInterval(lagInterval)
        stream.getTracks().forEach(t => t.stop())
        return { ok: false, error: error?.message || String(error) }
      }
    },
    {
      mimeType,
      bitrate: BITRATE,
      warmupMs: WARMUP_MS,
      durationMs: DURATION_MS,
      frameRate: FRAME_RATE,
      width: WIDTH,
      height: HEIGHT,
      wantBase64: true // enables saving to disk
    }
  )

const benchmarkCodec = async ({ page, mimeType, saveDir }) => {
  const supported = await page.evaluate(mimeType => {
    const MR = globalThis.MediaRecorder
    return !!MR && typeof MR.isTypeSupported === 'function' && MR.isTypeSupported(mimeType)
  }, mimeType)

  if (!supported) {
    return {
      codec: mimeType,
      supported: false,
      attempts: 0,
      success: 0,
      failure: 0,
      avgBytes: 0,
      avgElapsedMs: 0,
      avgEffectiveBps: 0,
      avgFpsDrawn: 0,
      avgP95LagMs: 0,
      // perf
      avgTaskMs: null,
      avgScriptMs: null,
      avgLayoutMs: null,
      avgHeapUsedDeltaBytes: null,
      avgMemUsedDeltaBytes: null,
      errors: []
    }
  }

  const runs = []

  for (let i = 0; i < ITERATIONS; i++) {
    // Start sampling just for the “real” recording window (warmup happens inside page)
    // This approximates “cost while recording”; warmup overhead still exists but is less important.
    const sampler = await startCdpSampling(page, 250)

    const res = await runOne({ page, mimeType, iteration: i + 1, saveDir })

    const perf = await sampler.stop()

    // Save file if we got base64
    let file = null
    if (res.ok && res.base64) {
      const buf = Buffer.from(res.base64, 'base64')
      file = await writeRecording({
        dir: saveDir,
        mimeType,
        iteration: i + 1,
        buffer: buf
      })
    }

    runs.push({
      ...res,
      file,
      cdpSummary: perf.cdpSummary,
      memSummary: perf.memSummary
    })
  }

  const ok = runs.filter(r => r.ok)
  const bad = runs.filter(r => !r.ok)

  const avgOrNull = arr => (arr.length ? toFixed(average(arr)) : null)

  return {
    codec: mimeType,
    supported: true,
    attempts: runs.length,
    success: ok.length,
    failure: bad.length,
    avgBytes: toFixed(average(ok.map(r => r.bytes || 0))),
    avgElapsedMs: toFixed(average(ok.map(r => r.elapsedMs || 0))),
    avgEffectiveBps: toFixed(average(ok.map(r => r.effectiveVideoBps || 0))),
    avgFpsDrawn: toFixed(average(ok.map(r => r.avgFpsDrawn || 0))),
    avgP95LagMs: toFixed(average(ok.map(r => r.p95LagMs || 0))),
    // CDP perf (ms deltas across the run window)
    avgTaskMs: avgOrNull(ok.map(r => r.cdpSummary?.taskMs).filter(n => typeof n === 'number')),
    avgScriptMs: avgOrNull(ok.map(r => r.cdpSummary?.scriptMs).filter(n => typeof n === 'number')),
    avgLayoutMs: avgOrNull(ok.map(r => r.cdpSummary?.layoutMs).filter(n => typeof n === 'number')),
    avgHeapUsedDeltaBytes: avgOrNull(
      ok.map(r => r.cdpSummary?.heapUsedDeltaBytes).filter(n => typeof n === 'number')
    ),
    // performance.memory (Chrome-only)
    avgMemUsedDeltaBytes: avgOrNull(
      ok.map(r => r.memSummary?.usedDeltaBytes).filter(n => typeof n === 'number')
    ),
    // show a couple saved files
    saved: ok
      .map(r => r.file?.filename)
      .filter(Boolean)
      .slice(0, 3),
    errors: Array.from(new Set(bad.map(r => r.error).filter(Boolean)))
  }
}

const main = async () => {
  if (!BITRATE) {
    throw new Error(`Unknown QUALITY="${QUALITY}". Check VIDEO_BITS_PER_SECOND_BY_QUALITY.`)
  }

  await ensureDir(SAVE_DIR)

  const browser = createBrowser({
    headless: 'new',
    args: [...defaultArgs]
  })
  const browserless = await browser.createContext()

  try {
    const puppeteerBrowser = await browserless.browser()
    const page = await puppeteerBrowser.defaultBrowserContext().newPage()

    try {
      await page.goto(URL, { waitUntil: 'domcontentloaded' })

      const userAgent = await page.evaluate(() => navigator.userAgent)
      const hasMediaRecorder = await page.evaluate(
        () =>
          typeof globalThis.MediaRecorder !== 'undefined' &&
          typeof globalThis.MediaRecorder.isTypeSupported === 'function'
      )

      console.log('MediaRecorder codec benchmark')
      console.log(`URL: ${URL}`)
      console.log(`User Agent: ${userAgent}`)
      console.log(`MediaRecorder available: ${hasMediaRecorder}`)
      console.log(`Quality preset: ${QUALITY} (${BITRATE} bps)`)
      console.log(`Artifacts: ${SAVE_DIR}`)
      console.log(
        `Run config: iterations=${ITERATIONS}, warmupMs=${WARMUP_MS}, durationMs=${DURATION_MS}, frameRate=${FRAME_RATE}, width=${WIDTH}, height=${HEIGHT}`
      )

      if (!hasMediaRecorder) return

      const results = []
      for (const codec of CANDIDATES) {
        results.push(await benchmarkCodec({ page, mimeType: codec, saveDir: SAVE_DIR }))
      }

      console.table(
        results.map(r => ({
          codec: r.codec,
          supported: r.supported,
          attempts: r.attempts,
          success: r.success,
          failure: r.failure,
          avgBytes: r.avgBytes,
          avgElapsedMs: r.avgElapsedMs,
          avgEffectiveBps: r.avgEffectiveBps,
          avgFpsDrawn: r.avgFpsDrawn,
          avgP95LagMs: r.avgP95LagMs,
          avgTaskMs: r.avgTaskMs,
          avgScriptMs: r.avgScriptMs,
          avgLayoutMs: r.avgLayoutMs,
          avgHeapUsedDeltaBytes: r.avgHeapUsedDeltaBytes,
          avgMemUsedDeltaBytes: r.avgMemUsedDeltaBytes,
          saved: r.saved?.join(', ') || '',
          errors: r.errors?.join(' | ') || ''
        }))
      )
    } finally {
      if (!page.isClosed()) await page.close().catch(() => {})
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

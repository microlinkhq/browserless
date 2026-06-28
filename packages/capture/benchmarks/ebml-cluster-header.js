'use strict'

const { writeClusterHeader } = require('../src/recorder/ebml')

const ITERATIONS = Number(process.env.ITERATIONS || 1_000_000)
const WARMUP = Number(process.env.WARMUP || 100_000)
const FRAME_LENGTHS = Object.freeze([1200, 8192, 65_535, 250_000, 1_000_000])

const run = iterations => {
  let bytes = 0
  const start = process.hrtime.bigint()

  for (let i = 0; i < iterations; i++) {
    const header = writeClusterHeader(i % 3_600_000, FRAME_LENGTHS[i % FRAME_LENGTHS.length])
    bytes += header.length
  }

  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6
  return {
    iterations,
    elapsedMs,
    nsPerOp: (elapsedMs * 1e6) / iterations,
    opsPerSec: iterations / (elapsedMs / 1000),
    bytes
  }
}

run(WARMUP)
if (global.gc) global.gc()
const before = process.memoryUsage()
const result = run(ITERATIONS)
if (global.gc) global.gc()
const after = process.memoryUsage()

console.log(
  JSON.stringify(
    {
      iterations: result.iterations,
      elapsedMs: Number(result.elapsedMs.toFixed(2)),
      nsPerOp: Number(result.nsPerOp.toFixed(1)),
      opsPerSec: Math.round(result.opsPerSec),
      bytes: result.bytes,
      heapDelta: after.heapUsed - before.heapUsed,
      externalDelta: after.external - before.external
    },
    null,
    2
  )
)

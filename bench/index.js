/* eslint-disable no-console */

const browserless = require('..')()
const percentile = require('percentile')
const prettyMs = require('pretty-ms')

let results = []

const benchmark = async n => {
  console.log(`benchmark ${n} iterations\n`)
  for (let i = 0; i < n; i++) {
    const start = Date.now()
    await browserless.screenshot('https://kikobeats.com')
    const end = Date.now()
    const time = end - start
    console.log(`browser-${i} ${prettyMs(time)}`)
    results.push(time)
  }
}

const n = process.argv[2] || 10

benchmark(n)
  .then(() => {
    const p95 = percentile(95, results)
    console.log('\n---\n')
    console.log('percentile 95', prettyMs(p95))
    process.exit(0)
  })
  .catch(console.error)

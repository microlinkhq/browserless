const browserless = require('..')()
const percentile = require('percentile')
const prettyMs = require('pretty-ms')

const benchmark = async n => {
  console.log(`benchmark ${n} iterations\n`)
  let results = []

  for (let i = 0; i < n; i++) {
    const start = Date.now()
    await browserless.screenshot('https://kikobeats.com')
    const end = Date.now()
    const time = end - start
    console.log(`browser-${i} ${prettyMs(time)}`)
    results.push(time)
  }

  return results
}

const n = process.argv[2] || 10

benchmark(n)
  .then(results => {
    const p95 = percentile(95, results)
    const avg = results.reduce((acc, item) => acc + item, 0)
    console.log('\n---\n')
    console.log('avg\t', prettyMs(avg / results.length))
    console.log('p95\t', prettyMs(p95))
    process.exit(0)
  })
  .catch(console.error)

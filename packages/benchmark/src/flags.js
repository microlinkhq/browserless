'use strict'

const createBrowserless = require('browserless')
const bench = require('nanobench')

const { driver } = createBrowserless

const N = process.argv[2] || 1000

const FLAGS = [
  '--single-process',
  '--memory-pressure-off',
  '--enable-tcp-fast-open',
  '--enable-simple-cache-backend',
  '--enable-async-dns'
]

const args = driver.args.reduce((acc, flag) => {
  if (FLAGS.includes(flag)) return acc
  return [...acc, flag]
}, [])

const createBenchmark = ({ args }) => {
  const browserless = createBrowserless({ args })
  const titleBench = browserless.evaluate(async (page, response) => {
    await page.goto('https://example.com')
    await page.title()
  })
  titleBench.browserless = browserless
  return titleBench
}

const ITERATIONS = [...Array(N).keys()]

const createBench = ({ name, setup, teardown }) => {
  bench(name, async function (b) {
    const fn = setup()
    b.start()
    for (const i in ITERATIONS) {
      await fn(i)
    }
    b.end()
    await teardown(fn)
  })
}

createBench({
  name: 'base flags',
  setup: () => createBenchmark({ args }),
  teardown: fn => fn.browserless.close()
})

FLAGS.forEach(flag => {
  createBench({
    name: flag,
    setup: () => createBenchmark({ args: args.concat(flag) }),
    teardown: fn => fn.browserless.close()
  })
})

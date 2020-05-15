'use strict'

const createBrowserless = require('browserless')
const bench = require('nanobench')

const createTitleBenchmark = () => {
  const browserless = createBrowserless()

  const titleBench = browserless.evaluate(async (page, response) => {
    await page.goto('https://example.com')
    await page.title()
  })

  titleBench.browserless = browserless

  return titleBench
}

const N = process.argv[2] || 1000

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
  name: `get page title ${N} iterations`,
  setup: () => createTitleBenchmark(),
  teardown: fn => fn.browserless.destroy()
})

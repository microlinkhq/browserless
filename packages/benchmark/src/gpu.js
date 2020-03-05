'use strict'

const createBrowserless = require('browserless')
const bench = require('nanobench')

const { driver } = createBrowserless

const createGPUBenchmark = ({ withFlag }) => {
  const args = withFlag ? driver.args.concat(['--disable-gpu']) : driver.args
  const browserless = createBrowserless({ args })

  const gpuBench = browserless.evaluate(async (page, response) => {
    await page.setContent('<canvas width=800px height=800px></canvas>')
    await page.$eval('canvas', canvas => {
      const ctx = canvas.getContext('2d')
      ctx.setTransform(2, 0, 0, 2, 0, 0)
    })
  })

  gpuBench.browserless = browserless

  return gpuBench
}

const N = 1000

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
  name: 'with flag',
  setup: () => createGPUBenchmark({ withFlag: true }),
  teardown: fn => fn.browserless.destroy()
})

createBench({
  name: 'without flag',
  setup: () => createGPUBenchmark({ withFlag: false }),
  teardown: fn => fn.browserless.destroy()
})

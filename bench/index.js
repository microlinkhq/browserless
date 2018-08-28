'use strict'

const createBrowserless = require('..')
const asciichart = require('asciichart')
const prettyMs = require('pretty-ms')
const prettyObj = require('fmt-obj')
const Measured = require('measured')
const pSeries = require('p-series')
const meow = require('meow')

const cli = meow(
  `
    browserless benchmark utility
      $ bench <url> [flags] [options]

    Flags
      --method         Choose what method to run (html, text, pdf, screenshot).
      --pool           Enable pool mode.
      --iterations     Number of iterations.
      --pool-min       Mininum of instances in pool mode.
      --pool-max       Maximum of instances in pool mode.

    Options
      The rest of parameters provided are passed as options.
`,
  {
    description: false,
    flags: {
      method: {
        type: 'string'
      },
      pool: {
        type: 'boolean',
        default: false
      },
      iterations: {
        type: 'number',
        default: 10
      }
    }
  }
)

const benchmark = async ({ browserless, method, url, opts, iterations }) => {
  const timer = new Measured.Timer()
  const promises = [...Array(iterations).keys()].map(n => {
    return async () => {
      const stopwatch = timer.start()
      await browserless[method](url, opts)
      const time = stopwatch.end()
      console.log(
        prettyObj({ iteration: n, time: prettyMs(time), rawTime: time })
      )
      return time
    }
  })

  const times = await pSeries(promises)
  const histogram = timer.toJSON().histogram
  return { times, histogram }
}
;(async () => {
  const [url] = cli.input
  if (!url) throw new TypeError('Need to provide an URL as target.')

  const {
    method,
    pool: isPool,
    poolMin,
    poolMax,
    iterations,
    ...opts
  } = cli.flags

  if (!method) throw new TypeError('Need to provide a method to run.')

  const browserless = isPool
    ? createBrowserless.pool({ min: poolMin, max: poolMax, ...opts })
    : createBrowserless(opts)

  console.log(prettyObj(cli.flags))
  const { times, histogram } = await benchmark({
    browserless,
    iterations,
    method,
    url,
    opts
  })

  const stats = Object.keys(histogram).reduce((acc, key) => {
    const value = histogram[key]
    return { ...acc, [key]: prettyMs(value) }
  }, {})

  const graph = asciichart.plot(times, { height: 6 })

  console.log()
  console.log(graph)
  console.log(prettyObj(stats))

  process.exit()
})()

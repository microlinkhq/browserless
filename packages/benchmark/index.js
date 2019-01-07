'use strict'

const createBrowserless = require('browserless')
const createBrowserlessPool = require('@browserless/pool')
const { includes, reduce } = require('lodash')
const processStats = require('process-stats')
const asciichart = require('asciichart')
const prettyMs = require('pretty-ms')
const prettyObj = require('fmt-obj')
const Measured = require('measured')
const pAll = require('p-all')
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
      --concurrency    Define number of concurrent request.
      --firefox        Use Firefox browser.

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
      concurrency: {
        type: 'number',
        default: 1
      },
      iterations: {
        type: 'number',
        default: 10
      },
      firefox: {
        type: 'boolean',
        default: false
      }
    }
  }
)

const benchmark = async ({
  browserless,
  method,
  url,
  opts,
  iterations,
  concurrency
}) => {
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

  const times = await pAll(promises, { concurrency })
  const histogram = timer.toJSON().histogram
  return { times, histogram }
}
;(async () => {
  const [url] = cli.input
  if (!url) throw new TypeError('Need to provide an URL as target.')

  const {
    method,
    concurrency,
    pool: isPool,
    poolMin,
    poolMax,
    iterations,
    firefox,
    ...opts
  } = cli.flags

  if (!method) throw new TypeError('Need to provide a method to run.')

  const puppeteer = firefox
    ? require('puppeteer-firefox')
    : require('puppeteer')

  const browserless = isPool
    ? createBrowserlessPool({ min: poolMin, max: poolMax, puppeteer, ...opts })
    : createBrowserless({ puppeteer, ...opts })

  console.log(prettyObj(cli.flags))

  const { times, histogram } = await benchmark({
    concurrency,
    browserless,
    iterations,
    method,
    url,
    opts
  })

  const stats = reduce(
    histogram,
    (acc, value, key) => {
      const newValue = !includes(['count'], key) ? prettyMs(value) : value

      return { ...acc, [key]: newValue }
    },
    {}
  )

  const graph = asciichart.plot(times, { height: 6 })
  const { memUsed } = processStats.process()

  console.log()
  console.log(graph)
  console.log(prettyObj({ memUsed: memUsed.pretty, ...stats }))

  process.exit()
})()

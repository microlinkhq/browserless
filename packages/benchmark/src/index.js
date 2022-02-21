'use strict'

process.setMaxListeners(Infinity)

const createBrowserless = require('browserless')
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
      --iterations     Number of iterations.
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
        default: 10
      },
      iterations: {
        type: 'number',
        default: 50
      },
      firefox: {
        type: 'boolean',
        default: false
      }
    }
  }
)

const benchmark = async ({ createBrowserless, method, url, opts, iterations, concurrency }) => {
  const timer = new Measured.Timer()
  const promises = [...Array(iterations).keys()].map(n => {
    return async () => {
      const stopwatch = timer.start()
      const browserless = await createBrowserless()
      await browserless[method](url, opts)
      await browserless.close()
      const time = stopwatch.end()
      const stats = processStats()

      console.log(
        `n=${n} cpu=${stats.cpu} mem=${stats.memUsed.pretty} eventLoop=${
          stats.delay.pretty
        } time=${prettyMs(time)}`
      )
      return time
    }
  })

  const times = await pAll(promises, { concurrency })
  const histogram = timer.toJSON().histogram
  return { times, histogram }
}

const main = async () => {
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

  const puppeteer = firefox ? require('puppeteer-firefox') : require('puppeteer')

  const { times, histogram } = await benchmark({
    concurrency,
    createBrowserless: createBrowserless({ puppeteer, ...opts }),
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
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })

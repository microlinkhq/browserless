'use strict'

const createBrowserless = require('browserless')
const processStats = require('process-stats')
const asciichart = require('asciichart')
const { gray } = require('picocolors')
const prettyMs = require('pretty-ms')
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

const benchmark = async ({
  browserlessFactory,
  concurrency,
  getStats,
  iterations,
  method,
  opts,
  url
}) => {
  const timer = new Measured.Timer()
  const promises = [...Array(iterations).keys()].map(n => {
    return async () => {
      const stopwatch = timer.start()
      const browserless = await browserlessFactory.createContext()
      await browserless[method](url, opts)
      await browserless.destroyContext()
      const time = stopwatch.end()
      const { cpu, delay, memUsed } = getStats()

      console.log(
        `  #${n < 10 ? `0${n}` : n} ${gray(
          `cpu=${cpu.pretty} mem=${memUsed.pretty} eventLoop=${delay.pretty} time=`
        )}${prettyMs(time)}`
      )
      return time
    }
  })

  const times = await pAll(promises, { concurrency })
  await getStats.destroy()
  const histogram = timer.toJSON().histogram
  return { times, histogram }
}

const main = async () => {
  const [url] = cli.input
  if (!url) throw new TypeError('Need to provide an URL as target.')

  const { method, concurrency, iterations, firefox, ...opts } = cli.flags

  if (!method) throw new TypeError('Need to provide a method to run.')

  const puppeteer = firefox ? require('puppeteer-firefox') : require('puppeteer')

  const getStats = processStats()
  const browserlessFactory = createBrowserless({ puppeteer, ...opts })

  console.log()
  const { times, histogram } = await benchmark({
    browserlessFactory,
    concurrency,
    getStats,
    iterations,
    method,
    opts,
    url
  })

  const graph = asciichart.plot(times, {
    offset: 6,
    height: 10,
    format: time => prettyMs(time, { keepDecimalsOnWholeSeconds: true })
  })

  const { uptime, memUsed } = getStats()
  await Promise.all([getStats.destroy(), browserlessFactory.close()])

  console.log()
  console.log(graph)
  console.log(`
${gray('     time:')} ${uptime.pretty}
${gray('    count:')} ${histogram.count}
${gray('  memUsed:')} ${memUsed.pretty}
${gray('      min:')} ${prettyMs(histogram.min)}
${gray('      max:')} ${prettyMs(histogram.max)}
${gray('   median:')} ${prettyMs(histogram.median)}
${gray('      p75:')} ${prettyMs(histogram.p75)}
${gray('      p95:')} ${prettyMs(histogram.p95)}
${gray('      p99:')} ${prettyMs(histogram.p99)}
${gray('     p999:')} ${prettyMs(histogram.p999)}`)
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch(err => {
    console.error(err)
    process.exit(1)
  })

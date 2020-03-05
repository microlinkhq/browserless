'use strict'

const browserlessFactory = require('browserless')
const debug = require('debug-logfmt')('browserless:benchmark')
const percentile = require('percentile')
const timeSpan = require('time-span')
const prettyMs = require('pretty-ms')

const BROWSERLESS_TIMEOUT = 15000
const HEADLESS = true
// const TMP_FOLDER = '/tmp'

const createBrowserless = id =>
  browserlessFactory({
    headless: HEADLESS,
    lossyDeviceName: true,
    timeout: BROWSERLESS_TIMEOUT
    // executablePath: CHROME_EXECUTABLE_PATH,
    // userDataDir: path.join(TMP_FOLDER, 'puppeteer', id)
  })

const takeScreenshot = async ({ index, url }) => {
  const timer = {}

  timer.createBrowserless = timeSpan()
  const browserless = await createBrowserless(index)
  timer.createBrowserless = timer.createBrowserless()

  timer.screenshot = timeSpan()
  await browserless.screenshot(url)
  timer.screenshot = timer.screenshot()

  timer.destroy = timeSpan()
  await browserless.destroy()
  timer.destroy = timer.destroy()

  return timer
}

const main = async (fn, { iterations: n, ...props }) => {
  const iterations = [...Array(n).keys()]
  const acc = {}
  debug('starting')

  for (const index in iterations) {
    const timer = await fn({ index, ...props })
    debug({ iteration: index, ...timer })

    Object.keys(timer).forEach(key => {
      if (!acc[key]) acc[key] = []
      acc[key].push(timer[key])
    })
  }

  debug('finished')
  return acc
}

main(takeScreenshot, { iterations: 100, url: 'https://front-24ypc8or0.zeit.sh/' })
  .then(result => {
    console.log()
    Object.keys(result).forEach(key => {
      console.log(`  – ${key}: ${prettyMs(percentile(95, result[key]))}`)
    })
    process.exit()
  })
  .catch(err => console.error(err) && process.exit(1))

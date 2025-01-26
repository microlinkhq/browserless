'use strict'

const debug = require('debug-logfmt')('browserless:benchmark')
const timeSpan = require('@kikobeats/time-span')()
const createBrowser = require('browserless')
const percentile = require('percentile')
const ms = require('ms')

const HEADLESS = true
// const TMP_FOLDER = '/tmp'

const createBrowserless = id =>
  createBrowser({
    headless: HEADLESS,
    lossyDeviceName: true,
    timeout: 15000
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

  timer.close = timeSpan()
  await browserless.close()
  timer.close = timer.close()

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
      console.log(`  – ${key}: ${ms(percentile(95, result[key]))}`)
    })
  })
  .catch(error => console.error(error) || process.exit(1))

'use strict'

const browserlessFactory = require('browserless')
const debug = require('debug-logfmt')('browserless:benchmark')
const percentile = require('percentile')
const timeSpan = require('time-span')
const prettyMs = require('pretty-ms')

const puppeterPackage = 'puppeteer'

const puppeteer = require(puppeterPackage)
const puppeteerDevices = require(`${puppeterPackage}/DeviceDescriptors`)
const BROWSERLESS_TIMEOUT = 15000
const HEADLESS = true
const TMP_FOLDER = '/tmp'

// flags explained: https://peter.sh/experiments/chromium-command-line-switches/
// default flags: https://github.com/puppeteer/puppeteer/blob/master/lib/Launcher.js#L269
// AWS Lambda flags: https://github.com/alixaxel/chrome-aws-lambda/blob/10feb8d162626d34aad2ee1e657f20956f53fe11/source/index.js
const args = [
  // browserless original
  '--disable-cloud-import',
  '--disable-gesture-typing',
  '--disable-infobars',
  '--disable-notifications',
  '--disable-offer-store-unmasked-wallet-cards',
  '--disable-offer-upload-credit-cards',
  '--disable-print-preview',
  '--disable-speech-api',
  '--disable-tab-for-desktop-share',
  '--disable-translate',
  '--disable-voice-input',
  '--disable-wake-on-wifi',
  '--enable-async-dns',
  '--enable-simple-cache-backend',
  '--enable-tcp-fast-open',
  '--enable-webgl',
  '--hide-scrollbars',
  '--ignore-gpu-blacklist',
  '--mute-audio',
  '--no-default-browser-check',
  '--no-pings',
  '--no-zygote',
  '--prerender-from-omnibox=disabled',
  '--use-gl=swiftshader',
  '--no-sandbox',
  // extra
  '--disable-web-security',
  '--font-render-hinting=none', // could be 'none', 'medium'
  '--enable-font-antialiasing',
  // looks like `insights` doesn't work as expected, let try to disable single process
  '--single-process',
  '--memory-pressure-off'
]

const createBrowserless = id =>
  browserlessFactory({
    args,
    puppeteer,
    puppeteerDevices,
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

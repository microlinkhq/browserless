'use strict'

const debug = require('debug-logfmt')('browserless')
const pReflect = require('p-reflect')
const pidtree = require('pidtree')

const kill = async (pids, { signal = 'SIGKILL' } = {}) => {
  pids.forEach(pid => {
    try {
      process.kill(pid, signal)
    } catch (_) {}
  })
}

const args = [
  // base
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
  // perf
  '--single-process',
  '--memory-pressure-off'
]

const spawn = (puppeteer, launchOpts) =>
  puppeteer.launch({
    ignoreHTTPSErrors: true,
    // flags explained: https://peter.sh/experiments/chromium-command-line-switches/
    // default flags: https://github.com/puppeteer/puppeteer/blob/master/lib/Launcher.js#L269
    // AWS Lambda flags: https://github.com/alixaxel/chrome-aws-lambda/blob/10feb8d162626d34aad2ee1e657f20956f53fe11/source/index.js
    args,
    ...launchOpts
  })

const destroy = async (browser, opts) => {
  const { pid } = browser.process()
  const { value: pids = [] } = await pReflect(pidtree(pid, { root: true }))
  debug('destroy', { pids })
  kill(pids, opts)
  return { pids }
}

module.exports = { spawn, destroy, args }

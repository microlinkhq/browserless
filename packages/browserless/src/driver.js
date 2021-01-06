'use strict'

const debug = require('debug-logfmt')('browserless')

// flags explained: https://peter.sh/experiments/chromium-command-line-switches/
// default flags: https://github.com/puppeteer/puppeteer/blob/master/lib/Launcher.js#L269
// AWS Lambda flags: https://github.com/alixaxel/chrome-aws-lambda/blob/10feb8d162626d34aad2ee1e657f20956f53fe11/source/index.js
const args = ({ proxy }) =>
  [
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
    '--ignore-gpu-blocklist',
    '--mute-audio',
    '--no-default-browser-check',
    '--no-pings',
    '--no-zygote',
    '--prerender-from-omnibox=disabled',
    '--use-gl=swiftshader',
    '--no-sandbox',
    // disable navigator.webdriver
    /// https://stackoverflow.com/a/60409220
    // https://blog.m157q.tw/posts/2020/09/11/bypass-cloudflare-detection-while-using-selenium-with-chromedriver/
    '--disable-blink-features=AutomationControlled',
    // extra
    '--disable-web-security',
    '--font-render-hinting=none', // could be 'none', 'medium'
    // '--enable-font-antialiasing'
    // perf
    // '--single-process',
    // '--memory-pressure-off',
    proxy && `--proxy-server=${proxy.protocol}://${proxy.hostname}:${proxy.port}`
  ].filter(Boolean)

const spawn = (puppeteer, { mode = 'launch', proxy, ...launchOpts }) =>
  puppeteer[mode]({
    ignoreHTTPSErrors: true,
    // flags explained: https://peter.sh/experiments/chromium-command-line-switches/
    // default flags: https://github.com/puppeteer/puppeteer/blob/master/lib/Launcher.js#L269
    // AWS Lambda flags: https://github.com/alixaxel/chrome-aws-lambda/blob/10feb8d162626d34aad2ee1e657f20956f53fe11/source/index.js
    args: args({ proxy }),
    ...launchOpts
  })

const get = browser => (!browser ? {} : browser.process() || {})

const destroy = async (browser, { signal = 'SIGKILL' } = {}) => {
  const browserProcess = get(browser)

  const { pid } = browserProcess
  if (!pid) return

  try {
    browserProcess.kill(signal)
    debug('destroy', { pid, signal })
  } catch (error) {
    debug('error', { pid, signal, message: error.message || error })
  }

  return { pid }
}

module.exports = { get, spawn, destroy, args }

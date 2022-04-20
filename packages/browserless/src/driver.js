'use strict'

const debug = require('debug-logfmt')('browserless')
const requireOneOf = require('require-one-of')
const pReflect = require('p-reflect')
const { promisify } = require('util')

const exec = promisify(require('child_process').exec)

// flags explained: https://peter.sh/experiments/chromium-command-line-switches
// default flags: https://github.com/puppeteer/puppeteer/blob/edb01972b9606d8b05b979a588eda0d622315981/src/node/Launcher.ts#L183
// AWS Lambda flags: https://github.com/alixaxel/chrome-aws-lambda/blob/78fdbf1b9b9a439883dc2fe747171a765b835031/source/index.ts#L94
const defaultArgs = [
  '--autoplay-policy=user-gesture-required', // https://source.chromium.org/search?q=lang:cpp+symbol:kAutoplayPolicy&ss=chromium
  '--disable-blink-features=AutomationControlled', // https://blog.m157q.tw/posts/2020/09/11/bypass-cloudflare-detection-while-using-selenium-with-chromedriver/
  '--disable-cloud-import',
  '--disable-component-update', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableComponentUpdate&ss=chromium
  '--disable-domain-reliability', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableDomainReliability&ss=chromium
  '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process', // https://source.chromium.org/search?q=file:content_features.cc&ss=chromium
  '--disable-gesture-typing',
  '--disable-infobars',
  '--disable-notifications',
  '--disable-offer-store-unmasked-wallet-cards',
  '--disable-offer-upload-credit-cards',
  '--disable-print-preview', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisablePrintPreview&ss=chromium
  '--disable-setuid-sandbox', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableSetuidSandbox&ss=chromium
  '--disable-site-isolation-trials', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableSiteIsolation&ss=chromium
  '--disable-speech-api', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableSpeechAPI&ss=chromium
  '--disable-tab-for-desktop-share',
  '--disable-translate',
  '--disable-voice-input',
  '--disable-wake-on-wifi',
  '--enable-async-dns',
  '--enable-simple-cache-backend',
  '--enable-tcp-fast-open',
  '--enable-webgl',
  '--force-webrtc-ip-handling-policy=default_public_interface_only',
  '--ignore-gpu-blocklist', // https://source.chromium.org/search?q=lang:cpp+symbol:kIgnoreGpuBlocklist&ss=chromium
  '--in-process-gpu', // https://source.chromium.org/search?q=lang:cpp+symbol:kInProcessGPU&ss=chromium
  '--no-default-browser-check', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoDefaultBrowserCheck&ss=chromium
  '--no-pings', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoPings&ss=chromium
  '--no-sandbox', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoSandbox&ss=chromium
  '--no-zygote', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoZygote&ss=chromium
  '--prerender-from-omnibox=disabled',
  '--use-gl=swiftshader' // https://source.chromium.org/search?q=lang:cpp+symbol:kUseGl&ss=chromium
]

const spawn = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  mode = 'launch',
  args = defaultArgs,
  ...launchOpts
} = {}) => puppeteer[mode]({ ignoreHTTPSErrors: true, args, ...launchOpts })

const getPid = childProcess => {
  if (!childProcess) return null
  if (childProcess.pid) return childProcess.pid
  const browserProcess = childProcess.process ? childProcess.process() : undefined
  if (!browserProcess) return null
  return browserProcess.pid
}

const killProcesssGroupPID = (pid, signal) =>
  process.platform === 'win32'
    ? exec(`taskkill /pid ${this.proc.pid} /T /F`)
    : Promise.resolve(process.kill(-pid, signal))

const close = async (childProcess, { signal = 'SIGKILL', ...debugOpts } = {}) => {
  const pid = getPid(childProcess)
  if (!pid) return

  // It's necessary to call `browser.close` for removing temporal files associated
  // and remove listeners attached to the main process; check
  // - https://github.com/puppeteer/puppeteer/blob/778ac92469d66c542c3c12fe0aa23703dd6315c2/src/node/BrowserRunner.ts#L146
  // - https://github.com/puppeteer/puppeteer/blob/69d85e874416d62de6e821bef30e5cebcfd42f15/src/node/BrowserRunner.ts#L189
  await pReflect(childProcess.close ? childProcess.close() : killProcesssGroupPID(pid, signal))

  debug('close', { pid, signal, ...debugOpts })
  return { pid }
}

module.exports = { spawn, getPid, close, defaultArgs }

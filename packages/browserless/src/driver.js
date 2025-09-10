'use strict'

const killProcessGroup = require('kill-process-group')
const debug = require('debug-logfmt')('browserless')
const requireOneOf = require('require-one-of')
const pReflect = require('p-reflect')

// flags explained: https://peter.sh/experiments/chromium-command-line-switches
// features explained: https://niek.github.io/chrome-features/
// popular flags: https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md
// default flags: https://github.com/puppeteer/puppeteer/blob/79399e426d8263eca506469aeb3e27b0a41f3418/packages/puppeteer-core/src/node/ChromeLauncher.ts#L204
// AWS Lambda flags: https://github.com/Sparticuz/chromium/blob/4bb59288a8e6c7ccbe78124f9541fbda7564b54b/source/index.ts#L33
const defaultArgs = [
  '--ash-no-nudges', // https://source.chromium.org/search?q=lang:cpp+symbol:kAshNoNudges&ss=chromium
  '--autoplay-policy=user-gesture-required', // https://source.chromium.org/search?q=lang:cpp+symbol:kAutoplayPolicy&ss=chromium
  '--disable-blink-features=PrettyPrintJSONDocument,AutomationControlled', // https://blog.m157q.tw/posts/2020/09/11/bypass-cloudflare-detection-while-using-selenium-with-chromedriver/
  '--disable-domain-reliability', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableDomainReliability&ss=chromium
  '--disable-notifications', // https://source.chromium.org/search?q=lang%3Acpp+symbol%3AkDisablePermissionsAPI&ss=chromium
  '--disable-print-preview', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisablePrintPreview&ss=chromium
  '--disable-setuid-sandbox', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableSetuidSandbox&ss=chromium
  '--disable-site-isolation-trials', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableSiteIsolation&ss=chromium
  '--disable-speech-api', // https://source.chromium.org/search?q=lang:cpp+symbol:kDisableSpeechAPI&ss=chromium
  '--disk-cache-size=33554432', // https://source.chromium.org/search?q=lang:cpp+symbol:kDiskCacheSize&ss=chromium
  `--enable-features=${['SharedArrayBuffer'].join(',')}`,
  '--font-render-hinting=none', // https://github.com/puppeteer/puppeteer/issues/2410#issuecomment-2886054614
  '--ignore-gpu-blocklist', // https://source.chromium.org/search?q=lang:cpp+symbol:kIgnoreGpuBlocklist&ss=chromium
  '--in-process-gpu', // https://github.com/search?q=repo%3Achromium%2Fchromium%20in-process-gpu&type=code
  '--no-default-browser-check', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoDefaultBrowserCheck&ss=chromium
  '--no-pings', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoPings&ss=chromium
  '--no-sandbox', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoSandbox&ss=chromium
  '--no-zygote', // https://source.chromium.org/search?q=lang:cpp+symbol:kNoZygote&ss=chromium
  `--disable-features=${[
    'AudioServiceOutOfProcess',
    'CalculateNativeWinOcclusion',
    'CanvasOopRasterization',
    'InterestFeedV2',
    'IsolateOrigins',
    'PushMessaging',
    'site-per-process', // Disables OOPIF. https://www.chromium.org/Home/chromium-security/site-isolation
    'Vulkan',
    'WebGPU',
    'WebPayments'
  ].join(',')}`
]

const spawn = ({
  puppeteer = requireOneOf(['puppeteer', 'puppeteer-core', 'puppeteer-firefox']),
  mode = 'launch',
  args = defaultArgs,
  headless = true,
  ...launchOpts
} = {}) => puppeteer[mode]({ ignoreHTTPSErrors: true, args, headless, ...launchOpts })

const getPid = subprocess => {
  if ('pid' in subprocess) return subprocess.pid
  const browserProcess = 'process' in subprocess ? subprocess.process() : undefined
  if (browserProcess === undefined || browserProcess === null) return
  return 'pid' in browserProcess ? browserProcess.pid : undefined
}

const close = async (subprocess, { signal = 'SIGKILL', ...debugOpts } = {}) => {
  const pid = getPid(subprocess)
  if (pid === undefined) return

  // It's necessary to call `browser.close` for removing temporal files associated
  // and remove listeners attached to the main process; check
  // - https://github.com/puppeteer/puppeteer/blob/778ac92469d66c542c3c12fe0aa23703dd6315c2/src/node/BrowserRunner.ts#L146
  // - https://github.com/puppeteer/puppeteer/blob/69d85e874416d62de6e821bef30e5cebcfd42f15/src/node/BrowserRunner.ts#L189
  await pReflect('close' in subprocess ? subprocess.close() : killProcessGroup(subprocess, signal))

  debug('close', { pid, signal, ...debugOpts })
  return { pid }
}

module.exports = { spawn, pid: getPid, close, defaultArgs }

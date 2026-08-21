'use strict'

const debug = require('debug-logfmt')('browserless:ai')
const { crc32 } = require('node:zlib')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const { cacheRoot, hasFile } = require('./find-dir')
const runAi = require('./run-ai')

const withContext = async (getBrowserless, fn) => {
  let teardown
  const browserless = await getBrowserless(done => (teardown = done))
  try {
    return await fn(browserless)
  } finally {
    if (teardown) await teardown()
  }
}

const createMethod =
  (getBrowserless, spec) =>
    (url, { timeout = TIMEOUT, ...opts } = {}) =>
      withContext(getBrowserless, browserless =>
        browserless.evaluate(page => page.evaluate(runAi, { ...opts, ...spec }), { timeout })(url)
      )

const OVERRIDE_SEP = process.platform === 'win32' ? '|' : ':'

const FEATURES = 'OnDeviceModelForceCpuBackend,OptimizationHints'

const TIMEOUT = 300000

const readVarint = (buf, offset) => {
  let value = 0
  let shift = 0
  while (offset < buf.length) {
    const byte = buf[offset++]
    value |= (byte & 0x7f) << shift
    if ((byte & 0x80) === 0) return { value, offset }
    shift += 7
  }
  throw new Error('truncated protobuf varint')
}

const writeVarint = n => {
  const bytes = []
  while (n > 0x7f) {
    bytes.push((n & 0x7f) | 0x80)
    n >>>= 7
  }
  bytes.push(n)
  return Buffer.from(bytes)
}

const skipTextSafety = buf => {
  if (!buf.length || buf[0] !== 0x0a) return buf
  const { value: length, offset } = readVarint(buf, 1)
  const inner = buf.subarray(offset, offset + length)
  if (inner.subarray(-2).equals(Buffer.from([0x28, 0x01]))) return buf
  const patched = Buffer.concat([inner, Buffer.from([0x28, 0x01])])
  return Buffer.concat([
    Buffer.from([0x0a]),
    writeVarint(patched.length),
    patched,
    buf.subarray(offset + length)
  ])
}

const zipStore = entries => {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, data] of entries) {
    const nameBuf = Buffer.from(name)
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, data)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBuf)
    offset += 30 + nameBuf.length + data.length
  }
  const localBuf = Buffer.concat(locals)
  const centralBuf = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(localBuf.length, 16)
  return Buffer.concat([localBuf, centralBuf, end])
}

const ADAPTATIONS = [
  {
    name: 'prompt',
    target: 49,
    flag: 'OPTIMIZATION_TARGET_MODEL_EXECUTION_FEATURE_PROMPT_API',
    skipSafety: true
  },
  {
    name: 'summarize',
    target: 51,
    flag: 'OPTIMIZATION_TARGET_MODEL_EXECUTION_FEATURE_SUMMARIZE',
    skipSafety: true
  },
  {
    name: 'detect',
    target: 2,
    flag: 'OPTIMIZATION_TARGET_LANGUAGE_DETECTION',
    skipSafety: false
  }
]

const packAdaptation = (dir, { name, skipSafety }) => {
  const dest = path.join(
    os.tmpdir(),
    `browserless-ai-${name}-${process.pid}-${process.hrtime.bigint()}.crx3`
  )
  const read = file => {
    const filePath = path.join(dir, file)
    return fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0)
  }
  let config = read('on_device_model_execution_config.pb')
  if (config.length && skipSafety) config = skipTextSafety(config)
  const files = [
    ['model.tflite', read('model.tflite')],
    ['model-info.pb', read('model-info.pb')]
  ]
  if (config.length) files.push(['on_device_model_execution_config.pb', config])
  fs.writeFileSync(dest, zipStore(files))
  return dest
}

const resolveAdaptations = adaptationPath => {
  const stat = fs.statSync(adaptationPath)
  if (stat.isFile()) {
    return [`OPTIMIZATION_TARGET_LANGUAGE_DETECTION${OVERRIDE_SEP}${path.resolve(adaptationPath)}`]
  }

  const pairs = []
  for (const feature of ADAPTATIONS) {
    const dir =
      hasFile(path.join(adaptationPath, feature.name), 'model-info.pb') ||
      hasFile(path.join(adaptationPath, String(feature.target)), 'model-info.pb')
    if (dir) pairs.push(`${feature.flag}${OVERRIDE_SEP}${packAdaptation(dir, feature)}`)
    debug('adaptation', { name: feature.name, dir: dir || false })
  }
  return pairs
}

const chromeSupport = (...parts) =>
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', ...parts)
    : undefined

const resolveModelPath = dir => {
  if (dir) return hasFile(dir, 'weights.bin')
  const chrome = chromeSupport('OptGuideOnDeviceModel')
  return hasFile(cacheRoot(), 'weights.bin') || (chrome && hasFile(chrome, 'weights.bin'))
}

const resolveAdaptationPath = dir => {
  if (dir) return fs.existsSync(dir) ? dir : undefined
  if (hasFile(cacheRoot(), 'model-info.pb')) return cacheRoot()
  const store = chromeSupport('optimization_guide_model_store')
  return store && fs.existsSync(store) ? store : undefined
}

const launch = ({
  dir = process.env.BROWSERLESS_AI_DIR,
  userDataDir = process.env.BROWSERLESS_AI_PROFILE,
  timeout = TIMEOUT,
  protocolTimeout = timeout
} = {}) => {
  const modelPath = resolveModelPath(dir)
  const adaptationPath = resolveAdaptationPath(dir)

  const { defaultArgs } = require('browserless').driver
  const args = defaultArgs
    .filter(arg => arg !== '--no-startup-window')
    .map(arg => (arg.startsWith('--enable-features=') ? `${arg},${FEATURES}` : arg))
  if (process.env.BROWSERLESS_AI_DUMPIO) {
    args.push('--enable-logging=stderr', '--vmodule=optimization_guide*=1,on_device_model*=2')
  }
  args.push('--disable-model-download-verification')
  if (modelPath) {
    args.push(`--optimization-guide-ondevice-model-execution-override=${modelPath}`)
  }
  if (adaptationPath) {
    const pairs = resolveAdaptations(adaptationPath)
    if (pairs.length) args.push(`--optimization-guide-model-override=${pairs.join(',')}`)
  }
  const weights = modelPath && path.join(modelPath, 'weights.bin')
  debug('launch', {
    dir: dir || false,
    modelPath: modelPath || false,
    weightsBytes: weights && fs.existsSync(weights) ? fs.statSync(weights).size : 0,
    adaptationPath: adaptationPath || false,
    overrides: args.filter(
      arg =>
        arg.includes('optimization-guide') ||
        arg.includes('PromptAPI') ||
        arg.includes('Summarization')
    )
  })
  return {
    timeout,
    protocolTimeout,
    ...(userDataDir && { userDataDir }),
    ...(process.env.BROWSERLESS_AI_DUMPIO && { dumpio: true }),
    ...(process.env.CI && { headless: false }),
    args
  }
}

const createMethods = getBrowserless => {
  const prompt = createMethod(getBrowserless, { api: 'prompt' })
  return {
    prompt,
    extract: (url, opts = {}) => {
      if (!opts.schema && !opts.responseConstraint) {
        return Promise.reject(new Error('extract requires schema'))
      }
      return prompt(url, { temperature: 0, topK: 1, ...opts })
    },
    summarize: createMethod(getBrowserless, { api: 'summarize' }),
    translate: createMethod(getBrowserless, { api: 'translate' }),
    detectLanguage: createMethod(getBrowserless, { api: 'detectLanguage' }),
    capabilities: ({ timeout = TIMEOUT, url = 'https://example.com' } = {}) =>
      withContext(getBrowserless, async browserless => {
        const ctors = await browserless.evaluate(
          page =>
            page.evaluate(() => ({
              languageModel: typeof globalThis.LanguageModel,
              summarizer: typeof globalThis.Summarizer,
              translator: typeof globalThis.Translator,
              languageDetector: typeof globalThis.LanguageDetector
            })),
          { timeout: Math.min(timeout, 30000) }
        )(url)
        debug('ctors', ctors)
        const started = Date.now()
        let available
        let lastError
        for (;;) {
          const left = timeout - (Date.now() - started)
          if (left <= 0) break
          try {
            available = await browserless.evaluate(
              page => page.evaluate(runAi, { api: 'availability' }),
              { timeout: Math.min(20000, left) }
            )(url)
            lastError = undefined
          } catch (error) {
            lastError = error
            if (left <= 20000) throw error
            await new Promise(resolve => setTimeout(resolve, 2000))
            continue
          }
          const apis = available.apis || available
          const pending = ['languageModel', 'summarizer', 'languageDetector'].some(
            api => apis[api] === 'downloading'
          )
          if (!pending) break
          await new Promise(resolve => setTimeout(resolve, 2000))
        }
        if (!available) throw lastError || new Error('capabilities timed out')
        debug('capabilities', available.apis || available, available.env)
        return available.apis || available
      })
  }
}

const createAi = (input = {}) => {
  if (typeof input === 'function') return createMethods(input)

  const browser = require('browserless')(launch(input))
  const methods = createMethods(async teardown => {
    const browserless = await browser.createContext()
    teardown(() => browserless.destroyContext())
    return browserless
  })
  methods.close = () => browser.close()
  return methods
}

module.exports = createAi
module.exports.launch = launch
module.exports.unpack = require('./unpack')
module.exports.download = dest => {
  const { credentials, downloadFile } = require('../scripts/util')
  const env = credentials()
  if (!env.endpoint || !env.bucket || !env.accessKey || !env.secretKey) {
    throw new Error('set R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY')
  }
  return downloadFile(env, dest)
}

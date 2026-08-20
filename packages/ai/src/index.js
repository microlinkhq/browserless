'use strict'

const { crc32 } = require('node:zlib')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')

const runAi = async spec => {
  const parseJson = raw => {
    try {
      return JSON.parse(raw)
    } catch (error) {
      const start = String(raw).indexOf('{')
      const end = String(raw).lastIndexOf('}')
      if (start !== -1 && end > start) {
        try {
          return JSON.parse(raw.slice(start, end + 1))
        } catch {}
      }
      const preview = String(raw).replace(/\s+/g, ' ').slice(0, 160)
      throw new Error(`LanguageModel did not return JSON: ${preview}`, { cause: error })
    }
  }

  const names = {
    prompt: 'LanguageModel',
    summarize: 'Summarizer',
    translate: 'Translator',
    detectLanguage: 'LanguageDetector'
  }

  if (spec.api === 'availability') {
    const probes = {
      languageModel: {
        expectedInputs: [{ type: 'text', languages: ['en'] }],
        expectedOutputs: [{ type: 'text', languages: ['en'] }]
      },
      summarizer: { expectedInputLanguages: ['en'], outputLanguage: 'en' },
      translator: { sourceLanguage: 'en', targetLanguage: 'es' },
      languageDetector: { expectedInputLanguages: ['en'] }
    }
    const ctors = {
      languageModel: 'LanguageModel',
      summarizer: 'Summarizer',
      translator: 'Translator',
      languageDetector: 'LanguageDetector'
    }
    const result = {}
    for (const [api, name] of Object.entries(ctors)) {
      const Ctor = globalThis[name]
      if (typeof Ctor === 'undefined') {
        result[api] = 'unavailable'
        continue
      }
      try {
        result[api] = await Ctor.availability(probes[api])
      } catch {
        result[api] = 'unavailable'
      }
    }
    return result
  }

  const schema = spec.schema || spec.responseConstraint
  const name = schema && spec.api === 'summarize' ? 'LanguageModel' : names[spec.api]
  const Ctor = globalThis[name]
  if (typeof Ctor === 'undefined') throw new Error(`${name} is not available`)

  const createKeys = {
    prompt: ['initialPrompts', 'expectedInputs', 'expectedOutputs', 'temperature', 'topK'],
    summarize: [
      'type',
      'format',
      'length',
      'sharedContext',
      'expectedInputLanguages',
      'outputLanguage',
      'expectedContextLanguages'
    ],
    translate: ['sourceLanguage', 'targetLanguage'],
    detectLanguage: ['expectedInputLanguages']
  }

  const createOpts = {}
  for (const key of createKeys[spec.api] || createKeys.prompt) {
    if (spec[key] !== undefined) createOpts[key] = spec[key]
  }

  if (spec.api === 'translate' && (!createOpts.sourceLanguage || !createOpts.targetLanguage)) {
    throw new Error('Translator requires sourceLanguage and targetLanguage')
  }

  let availability = await Ctor.availability(createOpts)
  if (availability === 'unavailable') throw new Error(`${name} is unavailable`)

  if (availability === 'downloading') {
    const started = Date.now()
    while (availability === 'downloading' && Date.now() - started < 60000) {
      await new Promise(resolve => setTimeout(resolve, 250))
      availability = await Ctor.availability(createOpts)
    }
    if (availability === 'unavailable' || availability === 'downloading') {
      throw new Error(`${name} is ${availability}`)
    }
  }

  const instance = await Ctor.create({
    ...createOpts,
    monitor (m) {
      m.addEventListener('downloadprogress', e => {
        console.log(`download ${name} ${Math.round(e.loaded * 100)}%`)
      })
    }
  })
  try {
    const input =
      spec.text !== undefined
        ? spec.text
        : (globalThis.document && globalThis.document.body && globalThis.document.body.innerText) ||
        ''
    if (spec.api === 'prompt' || schema) {
      const result = await instance.prompt(
        spec.prompt
          ? input
            ? `${spec.prompt}\n\n${input}`
            : spec.prompt
          : schema
            ? `Extract metadata from this page.\n\n${input}`
            : input,
        schema ? { responseConstraint: schema } : undefined
      )
      return schema ? parseJson(result) : result
    }
    if (spec.api === 'summarize') {
      return await instance.summarize(input, spec.context ? { context: spec.context } : undefined)
    }
    if (spec.api === 'translate') return await instance.translate(input)
    return await instance.detect(input)
  } finally {
    if (typeof instance.destroy === 'function') instance.destroy()
  }
}

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
    (url, { timeout, ...opts } = {}) =>
      withContext(getBrowserless, browserless =>
        browserless.evaluate(page => page.evaluate(runAi, { ...opts, ...spec }), { timeout })(url)
      )

const FEATURES = 'PromptAPIForGeminiNano,SummarizationAPIForGeminiNano'

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

const findDirWith = (root, needed) => {
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return
  const names = fs.readdirSync(root)
  if (needed.every(name => names.includes(name))) return root
  for (const name of names) {
    const next = path.join(root, name)
    if (fs.statSync(next).isDirectory()) {
      const found = findDirWith(next, needed)
      if (found) return found
    }
  }
}

const packAdaptation = (dir, { name, skipSafety }) => {
  const dest = path.join(os.tmpdir(), `browserless-ai-${name}.crx3`)
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
    return [`OPTIMIZATION_TARGET_LANGUAGE_DETECTION:${path.resolve(adaptationPath)}`]
  }

  const pairs = []
  for (const feature of ADAPTATIONS) {
    const dir =
      findDirWith(path.join(adaptationPath, feature.name), ['model-info.pb']) ||
      findDirWith(path.join(adaptationPath, String(feature.target)), ['model-info.pb'])
    if (dir) pairs.push(`${feature.flag}:${packAdaptation(dir, feature)}`)
  }
  return pairs
}

const chromeSupport = (...parts) =>
  process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support', 'Google', 'Chrome', ...parts)
    : undefined

const resolveModelPath = dir =>
  findDirWith(dir || chromeSupport('OptGuideOnDeviceModel') || '', ['weights.bin'])

const resolveAdaptationPath = dir => {
  if (dir) return dir
  const store = chromeSupport('optimization_guide_model_store')
  return store && fs.existsSync(store) ? store : undefined
}

const launch = ({
  dir = process.env.BROWSERLESS_AI_DIR,
  timeout,
  protocolTimeout = timeout
} = {}) => {
  const modelPath = resolveModelPath(dir)
  const adaptationPath = resolveAdaptationPath(dir)

  const { defaultArgs } = require('browserless').driver
  const args = defaultArgs.map(arg =>
    arg.startsWith('--enable-features=') ? `${arg},${FEATURES}` : arg
  )
  args.push('--optimization-guide-on-device-model=Enabled')
  if (modelPath) {
    args.push(`--optimization-guide-ondevice-model-execution-override=${modelPath}`)
  }
  if (adaptationPath) {
    const pairs = resolveAdaptations(adaptationPath)
    if (pairs.length) args.push(`--optimization-guide-model-override=${pairs.join(',')}`)
  }
  return {
    ...(timeout != null && { timeout }),
    ...(protocolTimeout != null && { protocolTimeout }),
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
    capabilities: ({ timeout, url = 'https://example.com' } = {}) =>
      withContext(getBrowserless, browserless =>
        browserless.evaluate(page => page.evaluate(runAi, { api: 'availability' }), { timeout })(
          url
        )
      )
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

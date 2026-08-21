'use strict'

const createHelpers = require('@browserless/test/create')
const test = require('ava')

const { cacheRoot, hasFile } = require('../src/find-dir')
const createAi = require('..')

const hasModel = () =>
  Boolean(hasFile(process.env.BROWSERLESS_AI_DIR || cacheRoot(), 'weights.bin'))

const requireApi = (t, available, name) => {
  if (available[name] === 'available') return true
  t.false(hasModel(), `${name} should be available with the packed model`)
  return false
}

const { getBrowserContext } = createHelpers({
  timeout: 300000,
  ...createAi.launch({ timeout: 300000 })
})

const ai = t => createAi(() => getBrowserContext(t))

const url = 'https://example.com'

test('factory methods', t => {
  const methods = createAi(() => {})
  t.true(typeof methods.prompt === 'function')
  t.true(typeof methods.extract === 'function')
  t.true(typeof methods.summarize === 'function')
  t.true(typeof methods.translate === 'function')
  t.true(typeof methods.detectLanguage === 'function')
  t.true(typeof methods.capabilities === 'function')
  t.is(methods.close, undefined)
})

test('createAi() owns the browser', async t => {
  const methods = createAi()
  t.true(typeof methods.close === 'function')
  await methods.close()
})

test('launch overrides on-device models for Chrome for Testing', t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const dir = path.join(os.tmpdir(), 'browserless-ai-launch-test')
  fs.mkdirSync(path.join(dir, 'nano'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'detect'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'nano', 'weights.bin'), '')
  fs.writeFileSync(path.join(dir, 'detect', 'model-info.pb'), '')
  fs.mkdirSync(path.join(dir, 'prompt'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'prompt', 'model-info.pb'), '')
  fs.writeFileSync(
    path.join(dir, 'prompt', 'on_device_model_execution_config.pb'),
    Buffer.from([0x0a, 0x00])
  )
  const { args, timeout, protocolTimeout } = createAi.launch({ dir, timeout: 120000 })
  t.true(
    args.some(arg => arg.includes(`ondevice-model-execution-override=${path.join(dir, 'nano')}`))
  )
  t.true(args.some(arg => arg.includes('OPTIMIZATION_TARGET_LANGUAGE_DETECTION')))
  t.true(args.some(arg => arg.includes('OPTIMIZATION_TARGET_MODEL_EXECUTION_FEATURE_PROMPT_API')))
  t.true(args.some(arg => arg.includes('PromptAPIForGeminiNano')))
  t.true(args.some(arg => arg.includes('OnDeviceModelForceCpuBackend')))
  t.true(args.some(arg => arg.includes('OptimizationHints')))
  t.true(args.some(arg => arg.includes('--optimization-guide-performance-class=3')))
  t.is(timeout, 120000)
  t.is(protocolTimeout, 120000)
})

test('launch ignores a missing dir', t => {
  const { args } = createAi.launch({ dir: '/no/such/browserless-ai-dir' })
  t.false(args.some(arg => arg.includes('ondevice-model-execution-override')))
  t.false(args.some(arg => arg.includes('optimization-guide-model-override=')))
})

test('launch accepts a single adaptation file', t => {
  const fs = require('node:fs')
  const os = require('node:os')
  const path = require('node:path')
  const file = path.join(os.tmpdir(), 'browserless-ai-adapt.crx3')
  fs.writeFileSync(file, '')
  const { args } = createAi.launch({ dir: file })
  t.true(args.some(arg => arg.includes(`OPTIMIZATION_TARGET_LANGUAGE_DETECTION:${file}`)))
})

test('capabilities reports each API', async t => {
  const available = await ai(t).capabilities()
  t.deepEqual(Object.keys(available).sort(), [
    'languageDetector',
    'languageModel',
    'summarizer',
    'translator'
  ])
  for (const value of Object.values(available)) t.is(typeof value, 'string')
  if (hasModel()) {
    t.is(available.languageModel, 'available')
    t.is(available.summarizer, 'available')
    t.is(available.languageDetector, 'available')
  }
})

test('extract requires schema', async t => {
  const error = await t.throwsAsync(createAi(() => {}).extract(url, { text: 'Hello' }))
  t.true(error.message.includes('schema'))
})

test('translate requires sourceLanguage and targetLanguage', async t => {
  const error = await t.throwsAsync(ai(t).translate(url, { text: 'Hello' }))
  t.true(error.message.includes('Translator'))
})

test('detectLanguage', async t => {
  const methods = ai(t)
  const available = await methods.capabilities()
  if (!requireApi(t, available, 'languageDetector')) return
  const result = await methods.detectLanguage(url, { text: 'Hello, how are you today?' })
  t.true(Array.isArray(result))
  t.true(result.length > 0)
  t.is(typeof result[0].detectedLanguage, 'string')
})

test('summarize', async t => {
  const methods = ai(t)
  const available = await methods.capabilities()
  if (!requireApi(t, available, 'summarizer')) return
  const result = await methods.summarize(url, {
    type: 'tldr',
    text: 'Chrome is a web browser made by Google. It is available on many platforms.'
  })
  t.is(typeof result, 'string')
  t.true(result.length > 0)
})

test('prompt', async t => {
  const methods = ai(t)
  const available = await methods.capabilities()
  if (!requireApi(t, available, 'languageModel')) return
  const result = await methods.prompt(url, { prompt: 'Reply with the word ok.', text: '' })
  t.is(typeof result, 'string')
  t.true(result.length > 0)
})

test('translate', async t => {
  const methods = ai(t)
  const available = await methods.capabilities()
  if (available.translator !== 'available') return t.pass()
  const result = await methods.translate(url, {
    text: 'Hello',
    sourceLanguage: 'en',
    targetLanguage: 'es'
  })
  t.is(typeof result, 'string')
  t.true(result.length > 0)
})

'use strict'

const runAi = async spec => {
  const names = {
    prompt: 'LanguageModel',
    summarize: 'Summarizer',
    translate: 'Translator',
    detectLanguage: 'LanguageDetector'
  }

  if (spec.api === 'availability') {
    const result = {}
    for (const [api, name] of Object.entries({
      languageModel: 'LanguageModel',
      summarizer: 'Summarizer',
      translator: 'Translator',
      languageDetector: 'LanguageDetector'
    })) {
      const Ctor = globalThis[name]
      if (typeof Ctor === 'undefined') {
        result[api] = false
        continue
      }
      try {
        result[api] = (await Ctor.availability()) !== 'unavailable'
      } catch {
        result[api] = false
      }
    }
    return result
  }

  const name = names[spec.api]
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
  for (const key of createKeys[spec.api]) {
    if (spec[key] !== undefined) createOpts[key] = spec[key]
  }

  if (spec.api === 'translate' && (!createOpts.sourceLanguage || !createOpts.targetLanguage)) {
    throw new Error('Translator requires sourceLanguage and targetLanguage')
  }

  const availability = await Ctor.availability(createOpts)
  if (availability === 'unavailable') throw new Error(`${name} is unavailable`)

  const instance = await Ctor.create(createOpts)
  try {
    const input =
      spec.text !== undefined
        ? spec.text
        : (globalThis.document && globalThis.document.body && globalThis.document.body.innerText) ||
        ''
    if (spec.api === 'prompt') {
      return instance.prompt(
        spec.prompt ? (input ? `${spec.prompt}\n\n${input}` : spec.prompt) : input
      )
    }
    if (spec.api === 'summarize') {
      return instance.summarize(input, spec.context ? { context: spec.context } : undefined)
    }
    if (spec.api === 'translate') return instance.translate(input)
    return instance.detect(input)
  } finally {
    if (typeof instance.destroy === 'function') instance.destroy()
  }
}

const createMethod =
  (getBrowserless, spec) =>
    async (url, { timeout, ...opts } = {}) => {
      let teardown
      const browserless = await getBrowserless(fn => (teardown = fn))

      try {
        return await browserless.evaluate(page => page.evaluate(runAi, { ...opts, ...spec }), {
          timeout
        })(url)
      } finally {
        if (teardown) await teardown()
      }
    }

module.exports = getBrowserless => ({
  prompt: createMethod(getBrowserless, { api: 'prompt' }),
  summarize: createMethod(getBrowserless, { api: 'summarize' }),
  translate: createMethod(getBrowserless, { api: 'translate' }),
  detectLanguage: createMethod(getBrowserless, { api: 'detectLanguage' }),
  availability: createMethod(getBrowserless, { api: 'availability' })
})

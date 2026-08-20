'use strict'

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
        name: 'LanguageModel',
        opts: {
          expectedInputs: [{ type: 'text', languages: ['en'] }],
          expectedOutputs: [{ type: 'text', languages: ['en'] }]
        }
      },
      summarizer: {
        name: 'Summarizer',
        opts: { expectedInputLanguages: ['en'], outputLanguage: 'en' }
      },
      translator: {
        name: 'Translator',
        opts: { sourceLanguage: 'en', targetLanguage: 'es' }
      },
      languageDetector: {
        name: 'LanguageDetector',
        opts: { expectedInputLanguages: ['en'] }
      }
    }
    const result = {}
    for (const [api, { name, opts }] of Object.entries(probes)) {
      const Ctor = globalThis[name]
      if (typeof Ctor === 'undefined') {
        result[api] = 'unavailable'
        continue
      }
      try {
        result[api] = await Ctor.availability(opts)
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
    const pageText =
      (globalThis.document && globalThis.document.body && globalThis.document.body.innerText) || ''
    const input = spec.text !== undefined ? spec.text : pageText
    if (spec.api === 'prompt' || schema) {
      let prompt = input
      if (spec.prompt) prompt = input ? `${spec.prompt}\n\n${input}` : spec.prompt
      else if (schema) prompt = `Extract metadata from this page.\n\n${input}`
      const result = await instance.prompt(
        prompt,
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

module.exports = runAi

'use strict'

const test = require('ava')

const runAi = require('../src/run-ai')

const NAMES = ['LanguageModel', 'Summarizer', 'Translator', 'LanguageDetector']

test.afterEach(() => {
  for (const name of NAMES) delete globalThis[name]
  delete globalThis.document
})

const ctor = (availability, methods = {}) => {
  const statuses = Array.isArray(availability) ? availability : [availability]
  return {
    availability: async () => statuses.shift() ?? statuses.at(-1) ?? 'available',
    create: async opts => {
      if (opts.monitor) {
        opts.monitor({
          addEventListener (_type, fn) {
            fn({ loaded: 0.5 })
          }
        })
      }
      return {
        destroy () {},
        ...methods
      }
    }
  }
}

test('availability reports missing constructors as unavailable', async t => {
  t.deepEqual(await runAi({ api: 'availability' }), {
    languageModel: 'unavailable',
    summarizer: 'unavailable',
    translator: 'unavailable',
    languageDetector: 'unavailable'
  })
})

test('availability uses constructor status and treats throws as unavailable', async t => {
  globalThis.LanguageModel = ctor('available')
  globalThis.Summarizer = {
    availability: async () => {
      throw new Error('nope')
    }
  }
  globalThis.Translator = ctor('downloadable')
  const result = await runAi({ api: 'availability' })
  t.is(result.languageModel, 'available')
  t.is(result.summarizer, 'unavailable')
  t.is(result.translator, 'downloadable')
  t.is(result.languageDetector, 'unavailable')
})

test('prompt concatenates prompt and text', async t => {
  let seen
  globalThis.LanguageModel = ctor('available', {
    prompt: async input => {
      seen = input
      return 'ok'
    }
  })
  t.is(await runAi({ api: 'prompt', prompt: 'Hi', text: 'there' }), 'ok')
  t.is(seen, 'Hi\n\nthere')
})

test('prompt without text uses the prompt only', async t => {
  let seen
  globalThis.LanguageModel = ctor('available', {
    prompt: async input => {
      seen = input
      return 'ok'
    }
  })
  t.is(await runAi({ api: 'prompt', prompt: 'Hi', text: '' }), 'ok')
  t.is(seen, 'Hi')
})

test('prompt reads page text when text is omitted', async t => {
  let seen
  globalThis.document = { body: { innerText: 'page body' } }
  globalThis.LanguageModel = ctor('available', {
    prompt: async input => {
      seen = input
      return 'ok'
    }
  })
  t.is(await runAi({ api: 'prompt' }), 'ok')
  t.is(seen, 'page body')
})

test('schema parses JSON and recovers a surrounding object', async t => {
  globalThis.LanguageModel = ctor('available', {
    prompt: async () => 'prefix {"title":"x"} suffix'
  })
  t.deepEqual(await runAi({ api: 'prompt', schema: { type: 'object' }, text: 'hi' }), {
    title: 'x'
  })
})

test('schema throws when the model does not return JSON', async t => {
  globalThis.LanguageModel = ctor('available', {
    prompt: async () => 'not json'
  })
  const error = await t.throwsAsync(
    runAi({ api: 'prompt', schema: { type: 'object' }, text: 'hi' })
  )
  t.true(error.message.includes('did not return JSON'))
})

test('schema without a prompt extracts metadata from the page', async t => {
  let seen
  globalThis.LanguageModel = ctor('available', {
    prompt: async (input, opts) => {
      seen = { input, opts }
      return '{"ok":true}'
    }
  })
  t.deepEqual(await runAi({ api: 'prompt', schema: { type: 'object' }, text: 'body' }), {
    ok: true
  })
  t.is(seen.input, 'Extract metadata from this page.\n\nbody')
  t.deepEqual(seen.opts, { responseConstraint: { type: 'object' } })
})

test('summarize with schema uses LanguageModel', async t => {
  globalThis.LanguageModel = ctor('available', {
    prompt: async () => '{"summary":"x"}'
  })
  t.deepEqual(await runAi({ api: 'summarize', schema: { type: 'object' }, text: 'long' }), {
    summary: 'x'
  })
})

test('summarize and detect and translate call the native methods', async t => {
  globalThis.Summarizer = ctor('available', {
    summarize: async (input, opts) => `sum:${input}:${opts.context}`
  })
  t.is(await runAi({ api: 'summarize', text: 'abc', context: 'ctx' }), 'sum:abc:ctx')

  globalThis.LanguageDetector = ctor('available', {
    detect: async input => [{ detectedLanguage: 'en', input }]
  })
  t.deepEqual(await runAi({ api: 'detectLanguage', text: 'Hello' }), [
    { detectedLanguage: 'en', input: 'Hello' }
  ])

  globalThis.Translator = ctor('available', {
    translate: async input => `es:${input}`
  })
  t.is(
    await runAi({
      api: 'translate',
      text: 'Hello',
      sourceLanguage: 'en',
      targetLanguage: 'es'
    }),
    'es:Hello'
  )
})

test('throws when the constructor is missing or unavailable', async t => {
  await t.throwsAsync(runAi({ api: 'prompt', text: 'x' }), { message: /not available/ })
  globalThis.LanguageModel = ctor('unavailable')
  await t.throwsAsync(runAi({ api: 'prompt', text: 'x' }), { message: /unavailable/ })
})

test('translate requires sourceLanguage and targetLanguage', async t => {
  globalThis.Translator = ctor('available', { translate: async () => 'x' })
  await t.throwsAsync(runAi({ api: 'translate', text: 'Hello' }), { message: /Translator/ })
})

test('waits while the model is downloading', async t => {
  globalThis.LanguageModel = ctor(['downloading', 'available'], {
    prompt: async () => 'ok'
  })
  t.is(await runAi({ api: 'prompt', text: 'x' }), 'ok')
})

test('passes create options through', async t => {
  let seen
  globalThis.LanguageModel = ctor('available', {
    prompt: async () => 'ok'
  })
  const original = globalThis.LanguageModel.create
  globalThis.LanguageModel.create = async opts => {
    seen = opts
    return original(opts)
  }
  await runAi({ api: 'prompt', text: 'x', temperature: 0, topK: 1 })
  t.is(seen.temperature, 0)
  t.is(seen.topK, 1)
})

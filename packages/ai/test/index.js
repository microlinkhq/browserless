'use strict'

const { getBrowserContext } = require('@browserless/test')
const test = require('ava')

const createAi = require('..')

const ai = t => createAi(() => getBrowserContext(t))

const url = 'https://example.com'

test('factory methods', t => {
  const methods = createAi(() => {})
  t.true(typeof methods.prompt === 'function')
  t.true(typeof methods.summarize === 'function')
  t.true(typeof methods.translate === 'function')
  t.true(typeof methods.detectLanguage === 'function')
  t.true(typeof methods.availability === 'function')
})

test('availability reports each API', async t => {
  const available = await ai(t).availability(url)
  t.deepEqual(Object.keys(available).sort(), [
    'languageDetector',
    'languageModel',
    'summarizer',
    'translator'
  ])
  for (const value of Object.values(available)) t.is(typeof value, 'boolean')
})

test('prompt throws when LanguageModel is missing or unavailable', async t => {
  const methods = ai(t)
  const available = await methods.availability(url)
  if (available.languageModel) return t.pass()
  const error = await t.throwsAsync(methods.prompt(url, { prompt: 'hi' }))
  t.true(error.message.includes('LanguageModel'))
})

test('summarize throws when Summarizer is missing or unavailable', async t => {
  const methods = ai(t)
  const available = await methods.availability(url)
  if (available.summarizer) return t.pass()
  const error = await t.throwsAsync(methods.summarize(url, { text: 'Hello world.' }))
  t.true(error.message.includes('Summarizer'))
})

test('translate requires sourceLanguage and targetLanguage', async t => {
  const error = await t.throwsAsync(ai(t).translate(url, { text: 'Hello' }))
  t.true(error.message.includes('Translator'))
})

test('summarize', async t => {
  const methods = ai(t)
  const available = await methods.availability(url)
  if (!available.summarizer) return t.pass()
  const result = await methods.summarize(url, {
    type: 'tldr',
    text: 'Chrome is a web browser made by Google. It is available on many platforms.'
  })
  t.is(typeof result, 'string')
  t.true(result.length > 0)
})

test('detectLanguage', async t => {
  const methods = ai(t)
  const available = await methods.availability(url)
  if (!available.languageDetector) return t.pass()
  const result = await methods.detectLanguage(url, { text: 'Hello, how are you today?' })
  t.true(Array.isArray(result))
  t.true(result.length > 0)
  t.is(typeof result[0].detectedLanguage, 'string')
})

test('translate', async t => {
  const methods = ai(t)
  const available = await methods.availability(url)
  if (!available.translator) return t.pass()
  const result = await methods.translate(url, {
    text: 'Hello',
    sourceLanguage: 'en',
    targetLanguage: 'es'
  })
  t.is(typeof result, 'string')
  t.true(result.length > 0)
})

test('prompt', async t => {
  const methods = ai(t)
  const available = await methods.availability(url)
  if (!available.languageModel) return t.pass()
  const result = await methods.prompt(url, { prompt: 'Reply with the word ok.', text: '' })
  t.is(typeof result, 'string')
  t.true(result.length > 0)
})

'use strict'

const { experimental_decide: decide } = require('ai')
const { createTypeSafeAi } = require('@ai-sdk/typesafe-ai')

const { askLanguageModel } = require('../src/model')
const agent = require('..')

const DEFAULT_URL = 'https://wallapop.com'
const DEFAULT_GOAL = 'busca el bmw x3 más barato'
const DEFAULT_LANGUAGE_MODELS = 'amazon/nova-micro,mistral/mistral-nemo'
const DEFAULT_SAMPLES = 10
const DEFAULT_REQUESTS_PER_MINUTE = 5
const MINUTE_MS = 61000
const MAX_LIVE_RUNS = 4
const REQUEST = { timeout: 25000, reasoning: 'none' }
const NINETIETH = 0.9

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const percentile = (values, fraction) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)]
}

const latency = values =>
  values.length === 0
    ? null
    : {
        min: Math.min(...values),
        median: percentile(values, 0.5),
        p90: percentile(values, NINETIETH),
        max: Math.max(...values)
      }

const timed = async call => {
  const started = performance.now()
  try {
    return { value: await call(), ms: Math.round(performance.now() - started) }
  } catch (error) {
    return { error: error.name, ms: Math.round(performance.now() - started) }
  }
}

const recordingDecisionModel = (model, recorded) => {
  const recording = Object.create(model)
  recording.doDecide = async options => {
    const result = await model.doDecide(options)
    recorded.push({ state: options.state, questions: options.questions })
    return result
  }
  return recording
}

const targetQuestion = operation => `${operation.toLowerCase()}_target`

const jevChoice = async (model, request) => {
  const { answers } = await decide({ model, ...request, maxRetries: 0 })
  const operation = answers.operation.choice
  return { operation, target: answers[targetQuestion(operation)]?.choice ?? null }
}

const languageChoice = async (model, request) => {
  const operationIds = Object.keys(request.questions.operation.criteria)
  const output = await askLanguageModel(request, operationIds, model, REQUEST)
  const hasTargets = targetQuestion(String(output?.operation)) in request.questions
  return { operation: output?.operation, target: hasTargets ? output?.target : null }
}

const replay = async (requests, choose, requestsPerMinute) => {
  const samples = []
  for (const [index, request] of requests.entries()) {
    if (requestsPerMinute && index > 0 && index % requestsPerMinute === 0) await sleep(MINUTE_MS)
    samples.push(await timed(() => choose(request)))
  }
  return samples
}

const sameChoice = (a, b) => a.operation === b.operation && a.target === b.target

const summarize = (samples, reference) => {
  const answered = samples.filter(sample => sample.value)
  const agreeing = (sample, index, matches) =>
    sample.value && reference[index].value && matches(sample.value, reference[index].value)
  return {
    requests: samples.length,
    answered: answered.length,
    errors: samples.filter(sample => sample.error).map(sample => sample.error),
    latencyMs: latency(answered.map(sample => sample.ms)),
    sameOperationAsJev: samples.filter((sample, index) =>
      agreeing(sample, index, (a, b) => a.operation === b.operation)
    ).length,
    sameOperationAndTargetAsJev: samples.filter((sample, index) =>
      agreeing(sample, index, sameChoice)
    ).length
  }
}

module.exports = async ({ page, browserless, opts }) => {
  if (!process.env.TYPESAFE_API_KEY) throw new TypeError('benchmark requires TYPESAFE_API_KEY.')
  const url = opts.url || DEFAULT_URL
  const goal = opts.goal || DEFAULT_GOAL
  const languageModels = String(opts.models || DEFAULT_LANGUAGE_MODELS).split(',')
  const sampleCount = Number(opts.samples || DEFAULT_SAMPLES)
  const requestsPerMinute = Number(opts.perMinute ?? DEFAULT_REQUESTS_PER_MINUTE)
  const jev = createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel('jev-latest')

  const recorded = []
  const liveRuns = []
  while (recorded.length < sampleCount && liveRuns.length < MAX_LIVE_RUNS) {
    await browserless.goto(page, { url })
    const before = recorded.length
    const status = await agent
      .goal(page, goal, {
        decisions: recordingDecisionModel(jev, recorded),
        text: opts.text
      })
      .then(({ status, error }) =>
        status === 'success' ? status : `${error.name}: ${error.message}`.slice(0, 120)
      )
    liveRuns.push({ status, decisions: recorded.length - before, finalUrl: page.url() })
  }
  const requests = recorded.slice(0, sampleCount)

  const jevSamples = await replay(requests, request => jevChoice(jev, request))
  const languageSamples = await Promise.all(
    languageModels.map(model =>
      replay(requests, request => languageChoice(model, request), requestsPerMinute)
    )
  )

  return {
    url,
    goal,
    liveRuns,
    replayedRequests: requests.length,
    deciders: {
      'jev-latest': summarize(jevSamples, jevSamples),
      ...Object.fromEntries(
        languageModels.map((model, index) => [model, summarize(languageSamples[index], jevSamples)])
      )
    }
  }
}

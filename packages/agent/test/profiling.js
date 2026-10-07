'use strict'

const test = require('ava')
const { MockLanguageModelV4 } = require('ai/test')
const agent = require('..')
const { costOf, createProfiling } = require('../src/profiling')
const { Page, state, answer, decisionModel, mockModels, RULES, DATA } = require('./fixtures/page')

const GOAL = 'find cheapest bmw x3'
const DELAY_MS = 25

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const gateway = (cost, generationId) => ({ gateway: { cost, generationId } })

const pricedDecisions = (operations, { delayMs = 0 } = {}) =>
  decisionModel(async ({ questions }) => {
    await sleep(delayMs)
    return {
      answers: Object.fromEntries(
        Object.entries(questions).map(([key, question]) => {
          const ids = Object.keys(question.criteria)
          return [key, answer(key === 'operation' ? operations.shift() : ids[0], ids)]
        })
      ),
      usage: { inputTokens: 3126, outputTokens: 206, totalTokens: 3332 },
      providerMetadata: gateway('0.000131292', 'gen_decision'),
      warnings: []
    }
  })

const pricedText = (text, { delayMs = 0 } = {}) =>
  new MockLanguageModelV4({
    doGenerate: async () => {
      await sleep(delayMs)
      return {
        content: [{ type: 'text', text }],
        finishReason: { unified: 'stop', raw: 'stop' },
        usage: {
          inputTokens: { total: 2410, noCache: 10, cacheRead: 1800, cacheWrite: 600 },
          outputTokens: { total: 57, text: 14, reasoning: 43 }
        },
        providerMetadata: gateway('0.0000304', 'gen_text'),
        warnings: []
      }
    }
  })

const evaluator = ({
  choice = 'yes',
  probabilities = { yes: 0.92, no: 0.08 },
  fail,
  delayMs = 0
} = {}) => {
  const calls = []
  const model = decisionModel(async options => {
    calls.push(options)
    await sleep(delayMs)
    if (fail?.(calls.length)) throw new Error('evaluator unavailable')
    return {
      answers: { passed: { type: 'choice', choice, probabilities } },
      usage: { inputTokens: 320, outputTokens: 31, totalTokens: 351 },
      providerMetadata: gateway('0.00001344', 'gen_evaluation'),
      warnings: []
    }
  })
  return { model, calls }
}

const run = (page, operations, { delayMs, ...options } = {}) =>
  agent.goal(page, GOAL, {
    decisions: pricedDecisions(operations, { delayMs }),
    text: pricedText('{"text":"bmw x3"}', { delayMs }),
    waitMs: 0,
    ...options
  })

test('goal resolves with status, the run and profiling, and serializes without the function', async t => {
  const result = await run(new Page(), ['DONE'], { evaluator: evaluator().model })
  t.deepEqual(Object.keys(result), ['status', 'steps', 'decisions', 'trace', 'profiling'])
  t.like(result, { status: 'success', steps: 0, decisions: 1 })
  t.is(result.trace.length, 1)
  t.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'success',
    steps: 0,
    decisions: 1,
    trace: JSON.parse(JSON.stringify(result.trace))
  })
})

test('the evaluator is not called until profiling is requested', async t => {
  const judge = evaluator()
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  t.is(judge.calls.length, 0)
  await info.profiling()
  t.is(judge.calls.length, 1)
})

test('profiling reports accuracy, cost with the evaluation included, and generation ids', async t => {
  const page = new Page([state(), state('bmw x3')])
  const info = await run(page, ['TYPE_TEXT', 'DONE'], { evaluator: evaluator().model })
  const { accuracy, cost, error } = await info.profiling()
  t.is(error, undefined)
  t.deepEqual(accuracy, { passed: true, probability: 0.92 })
  t.deepEqual(cost, {
    calls: 4,
    inputTokens: 8982,
    outputTokens: 500,
    cachedInputTokens: 1800,
    cacheWriteTokens: 600,
    reasoningTokens: 43,
    usd: 0.000306424,
    generationIds: ['gen_decision', 'gen_text', 'gen_decision', 'gen_evaluation']
  })
})

test('timing separates model time, other time and the evaluation', async t => {
  const page = new Page([state(), state('bmw x3')])
  const info = await run(page, ['TYPE_TEXT', 'DONE'], {
    delayMs: DELAY_MS,
    evaluator: evaluator({ delayMs: DELAY_MS }).model
  })
  const { timing } = await info.profiling()
  const goalCalls = 3
  t.true(timing.modelMs >= (DELAY_MS - 5) * goalCalls, `modelMs ${timing.modelMs}`)
  t.true(timing.evaluationMs >= DELAY_MS - 5, `evaluationMs ${timing.evaluationMs}`)
  t.true(timing.totalMs >= timing.modelMs)
  t.is(timing.otherMs, timing.totalMs - timing.modelMs)
})

test('a failed verdict is reported with the probability that the goal passed', async t => {
  const info = await run(new Page(), ['DONE'], {
    evaluator: evaluator({ choice: 'no', probabilities: { yes: 0.1, no: 0.9 } }).model
  })
  t.deepEqual((await info.profiling()).accuracy, { passed: false, probability: 0.1 })
})

test('the evaluator sees the final page, its fields, and the actions taken without the final verdict', async t => {
  const judge = evaluator()
  const page = new Page([state(), state('Results')])
  const info = await run(page, ['CLICK', 'DONE'], { evaluator: judge.model })
  await info.profiling()
  const [{ state: evaluated, questions }] = judge.calls
  t.is(evaluated.page.text, 'Results')
  t.true(evaluated.elements.length > 0)
  t.deepEqual(
    evaluated.recent_actions.map(entry => entry.operation),
    ['CLICK']
  )
  t.deepEqual(Object.keys(questions), ['passed'])
  t.deepEqual(Object.keys(questions.passed.criteria), ['yes', 'no'])
  t.is(questions.passed.instructions.goal, GOAL)
})

test('profiling is computed once and shared by concurrent callers', async t => {
  const judge = evaluator()
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const [first, second] = await Promise.all([info.profiling(), info.profiling()])
  t.is(first, second)
  t.is(await info.profiling(), first)
  t.is(judge.calls.length, 1)
})

test('a failed evaluation still reports cost and timing, and the next call retries', async t => {
  const judge = evaluator({ fail: attempt => attempt === 1 })
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const failed = await info.profiling()
  t.is(failed.accuracy, undefined)
  t.regex(failed.error.message, /evaluator unavailable/)
  t.is(failed.cost.calls, 1)
  t.is(failed.cost.usd, 0.000131292)
  t.true(Number.isInteger(failed.timing.totalMs))
  const retried = await info.profiling()
  t.deepEqual(retried.accuracy, { passed: true, probability: 0.92 })
  t.is(retried.error, undefined)
  t.is(judge.calls.length, 2)
})

test('concurrent callers share a failed evaluation, and a later call retries', async t => {
  const judge = evaluator({ fail: attempt => attempt === 1, delayMs: 10 })
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const [first, second] = await Promise.all([info.profiling(), info.profiling()])
  t.is(first, second)
  t.truthy(first.error)
  t.is(judge.calls.length, 1)
  t.deepEqual((await info.profiling()).accuracy, { passed: true, probability: 0.92 })
  t.is(judge.calls.length, 2)
})

test('profiling can be cancelled with a signal, and a later call evaluates again', async t => {
  const judge = evaluator({ delayMs: 200 })
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const cancelled = await info.profiling({ signal: AbortSignal.timeout(20) })
  t.is(cancelled.accuracy, undefined)
  t.truthy(cancelled.error)
  t.deepEqual((await info.profiling()).accuracy, { passed: true, probability: 0.92 })
})

test('aborting the goal signal after it resolved does not affect profiling', async t => {
  const controller = new AbortController()
  const info = await run(new Page(), ['DONE'], {
    evaluator: evaluator().model,
    signal: controller.signal
  })
  controller.abort()
  t.deepEqual((await info.profiling()).accuracy, { passed: true, probability: 0.92 })
})

test('an invalid evaluator answer is an error, with cost and timing still reported', async t => {
  const info = await run(new Page(), ['DONE'], {
    evaluator: evaluator({ probabilities: { yes: 0.5, no: 0.4 } }).model
  })
  const { accuracy, error, cost } = await info.profiling()
  t.is(accuracy, undefined)
  t.regex(error.message, /probabilities must sum to 1/)
  t.is(cost.calls, 1)
})

test('usd and token totals are undefined when any call did not report them', async t => {
  const models = mockModels(['DONE'])
  const info = await agent.goal(new Page(), GOAL, {
    decisions: models.decisions,
    text: models.text,
    evaluator: evaluator().model,
    waitMs: 0
  })
  const { cost } = await info.profiling()
  t.is(cost.calls, 2)
  t.is(cost.usd, undefined)
  t.is(cost.inputTokens, undefined)
  t.is(cost.outputTokens, undefined)
})

test('a blocked run reports the cost it already spent through its profiling', async t => {
  const page = new Page([state(), state()])
  const result = await run(page, ['BLOCKED'], {
    evaluator: evaluator({ choice: 'no', probabilities: { yes: 0, no: 1 } }).model
  })
  t.is(result.status, 'error')
  t.true(result.error instanceof agent.BlockedError)
  const { accuracy, cost } = await result.profiling()
  t.deepEqual(accuracy, { passed: false, probability: 0 })
  t.is(cost.calls, 2)
  t.is(cost.usd, 0.000144732)
})

test('a run blocked before any page was observed has no accuracy and calls no evaluator', async t => {
  const judge = evaluator()
  const profiling = createProfiling({
    goal: GOAL,
    state: undefined,
    trace: [],
    calls: [],
    totalMs: 5,
    evaluator: judge.model,
    timeout: 1000
  })
  const { accuracy, cost, timing, error } = await profiling()
  t.is(accuracy, undefined)
  t.is(error, undefined)
  t.is(cost.calls, 0)
  t.is(timing.totalMs, 5)
  t.is(judge.calls.length, 0)
})

test('an invalid evaluator fails before any model call', async t => {
  await t.throwsAsync(run(new Page(), ['DONE'], { evaluator: '' }), {
    instanceOf: TypeError,
    message: 'evaluator must be a model id or an AI SDK model.'
  })
})

test('an invalid evaluator does not affect rules and extract', async t => {
  const page = new Page()
  const result = await agent.extract(
    page,
    { title: { selector: 'h1', attr: 'text' } },
    { evaluator: '' }
  )
  t.is(result.status, 'success')
})

test('usd totals are rounded to remove float noise only', t => {
  const calls = [{ usd: 0.000131292 }, { usd: 0.0000304 }, { usd: 0.00001344 }]
  t.is(costOf(calls).usd, 0.000175132)
  t.is(costOf([{ usd: 1e-11 }]).usd, 1e-11)
})

const INSTRUCTION = 'get the cars'

test('extract from an instruction reports the rules it used, the request cost and the time', async t => {
  const page = new Page()
  const text = pricedText(JSON.stringify(RULES), { delayMs: DELAY_MS })
  const { status, data, profiling } = await agent.extract(page, INSTRUCTION, undefined, { text })
  t.is(status, 'success')
  t.deepEqual(data, DATA)
  const profile = await profiling()
  t.deepEqual(Object.keys(profile), ['rules', 'cost', 'timing'])
  t.deepEqual(profile.rules, page.appliedRules.at(-1))
  t.deepEqual(profile.cost, {
    calls: 1,
    inputTokens: 2410,
    outputTokens: 57,
    cachedInputTokens: 1800,
    cacheWriteTokens: 600,
    reasoningTokens: 43,
    usd: 0.0000304,
    generationIds: ['gen_text']
  })
  t.true(profile.timing.modelMs >= DELAY_MS - 1)
  t.true(profile.timing.totalMs >= profile.timing.modelMs)
  t.is(profile.timing.otherMs, profile.timing.totalMs - profile.timing.modelMs)
  t.is(await profiling(), profile)
})

test('extract from rules alone reports no request and no cost', async t => {
  const { profiling } = await agent.extract(new Page(), RULES)
  const profile = await profiling()
  t.is(profile.rules, RULES)
  t.like(profile.cost, { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, generationIds: [] })
  t.is(profile.timing.modelMs, 0)
})

test('the page method reports the same profiling', async t => {
  const page = agent(new Page(), { text: pricedText(JSON.stringify(RULES)) })
  const { profiling } = await page.extract(INSTRUCTION)
  t.like((await profiling()).cost, { calls: 1, usd: 0.0000304 })
})

test('an extraction that fails after its request still reports what the request cost', async t => {
  const page = new Page()
  page.data = {}
  const text = pricedText(JSON.stringify(RULES))
  const { status, error, profiling } = await agent.extract(page, INSTRUCTION, undefined, { text })
  t.is(status, 'error')
  t.is(error.message, 'The rules the model wrote matched nothing on the page.')
  const profile = await profiling()
  t.like(profile.cost, { calls: 1, usd: 0.0000304 })
  t.is(profile.rules, undefined)
})

test('rules a model wrote are reported even when the engine then fails', async t => {
  const page = new Page()
  const text = pricedText(JSON.stringify(RULES))
  const extractor = async () => {
    throw new Error('engine down')
  }
  const result = await agent.extract(page, INSTRUCTION, undefined, { text, extractor })
  t.is(result.status, 'error')
  t.is(result.error.message, 'engine down')
  const profile = await result.profiling()
  t.deepEqual(profile.rules, page.appliedRules.at(-1))
  t.like(profile.cost, { calls: 1, usd: 0.0000304 })
})

test('an engine failure of any kind still reports profiling', async t => {
  for (const thrown of ['text', 42, null, undefined, Object.freeze(new Error('frozen'))]) {
    const result = await agent.extract(new Page(), RULES, {
      extractor: async () => {
        throw thrown
      }
    })
    t.is(result.status, 'error')
    t.true(result.error instanceof Error)
    t.is((await result.profiling()).cost.calls, 0)
  }
})

test('the time of an extraction covers the engine as well as the request', async t => {
  const text = pricedText(JSON.stringify(RULES), { delayMs: DELAY_MS })
  const extractor = async () => {
    await sleep(DELAY_MS)
    return DATA
  }
  const { profiling } = await agent.extract(new Page(), INSTRUCTION, undefined, { text, extractor })
  const { timing } = await profiling()
  t.true(timing.totalMs >= 2 * DELAY_MS - 2)
  t.true(timing.otherMs >= DELAY_MS - 2)
})

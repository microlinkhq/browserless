'use strict'

const test = require('ava')
const { MockLanguageModelV4 } = require('ai/test')
const agent = require('..')
const { costOf, createInfo } = require('../src/info')
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

test('goal resolves to a callable that still exposes status, steps, decisions and trace', async t => {
  const result = await run(new Page(), ['DONE'], { evaluator: evaluator().model })
  t.is(typeof result, 'function')
  t.is(result.status, 'done')
  t.is(result.steps, 0)
  t.is(result.decisions, 1)
  t.is(result.trace.length, 1)
  t.deepEqual(JSON.parse(JSON.stringify(result)), {
    status: 'done',
    steps: 0,
    decisions: 1,
    trace: JSON.parse(JSON.stringify(result.trace))
  })
})

test('spreading the result keeps every field when serialized', async t => {
  const result = await run(new Page(), ['DONE'], { evaluator: evaluator().model })
  t.deepEqual(Object.keys(result), ['status', 'steps', 'decisions', 'trace'])
  const serialized = JSON.parse(JSON.stringify({ ...result, url: 'https://example.com' }))
  t.is(serialized.url, 'https://example.com')
  t.is(serialized.status, 'done')
})

test('the evaluator is not called until info is requested', async t => {
  const judge = evaluator()
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  t.is(judge.calls.length, 0)
  await info()
  t.is(judge.calls.length, 1)
})

test('info reports accuracy, cost with the evaluation included, and generation ids', async t => {
  const page = new Page([state(), state('bmw x3')])
  const info = await run(page, ['TYPE_TEXT', 'DONE'], { evaluator: evaluator().model })
  const { accuracy, cost, error } = await info()
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
  const { timing } = await info()
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
  t.deepEqual((await info()).accuracy, { passed: false, probability: 0.1 })
})

test('the evaluator sees the final page, its fields, and the actions taken without the final verdict', async t => {
  const judge = evaluator()
  const page = new Page([state(), state('Results')])
  const info = await run(page, ['CLICK', 'DONE'], { evaluator: judge.model })
  await info()
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

test('info is computed once and shared by concurrent callers', async t => {
  const judge = evaluator()
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const [first, second] = await Promise.all([info(), info()])
  t.is(first, second)
  t.is(await info(), first)
  t.is(judge.calls.length, 1)
})

test('a failed evaluation still reports cost and timing, and the next call retries', async t => {
  const judge = evaluator({ fail: attempt => attempt === 1 })
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const failed = await info()
  t.is(failed.accuracy, undefined)
  t.regex(failed.error.message, /evaluator unavailable/)
  t.is(failed.cost.calls, 1)
  t.is(failed.cost.usd, 0.000131292)
  t.true(Number.isInteger(failed.timing.totalMs))
  const retried = await info()
  t.deepEqual(retried.accuracy, { passed: true, probability: 0.92 })
  t.is(retried.error, undefined)
  t.is(judge.calls.length, 2)
})

test('concurrent callers share a failed evaluation, and a later call retries', async t => {
  const judge = evaluator({ fail: attempt => attempt === 1, delayMs: 10 })
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const [first, second] = await Promise.all([info(), info()])
  t.is(first, second)
  t.truthy(first.error)
  t.is(judge.calls.length, 1)
  t.deepEqual((await info()).accuracy, { passed: true, probability: 0.92 })
  t.is(judge.calls.length, 2)
})

test('info can be cancelled with a signal, and a later call evaluates again', async t => {
  const judge = evaluator({ delayMs: 200 })
  const info = await run(new Page(), ['DONE'], { evaluator: judge.model })
  const cancelled = await info({ signal: AbortSignal.timeout(20) })
  t.is(cancelled.accuracy, undefined)
  t.truthy(cancelled.error)
  t.deepEqual((await info()).accuracy, { passed: true, probability: 0.92 })
})

test('aborting the goal signal after it resolved does not affect info', async t => {
  const controller = new AbortController()
  const info = await run(new Page(), ['DONE'], {
    evaluator: evaluator().model,
    signal: controller.signal
  })
  controller.abort()
  t.deepEqual((await info()).accuracy, { passed: true, probability: 0.92 })
})

test('an invalid evaluator answer is an error, with cost and timing still reported', async t => {
  const info = await run(new Page(), ['DONE'], {
    evaluator: evaluator({ probabilities: { yes: 0.5, no: 0.4 } }).model
  })
  const { accuracy, error, cost } = await info()
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
  const { cost } = await info()
  t.is(cost.calls, 2)
  t.is(cost.usd, undefined)
  t.is(cost.inputTokens, undefined)
  t.is(cost.outputTokens, undefined)
})

test('a blocked run carries info for the cost it already spent', async t => {
  const page = new Page([state(), state()])
  const error = await t.throwsAsync(
    run(page, ['BLOCKED'], {
      evaluator: evaluator({ choice: 'no', probabilities: { yes: 0, no: 1 } }).model
    }),
    { instanceOf: agent.BlockedError }
  )
  const { accuracy, cost } = await error.info()
  t.deepEqual(accuracy, { passed: false, probability: 0 })
  t.is(cost.calls, 2)
  t.is(cost.usd, 0.000144732)
})

test('a run blocked before any page was observed has no accuracy and calls no evaluator', async t => {
  const judge = evaluator()
  const info = createInfo({
    goal: GOAL,
    state: undefined,
    trace: [],
    calls: [],
    totalMs: 5,
    evaluator: judge.model,
    timeout: 1000
  })
  const { accuracy, cost, timing, error } = await info()
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
  const data = await agent.extract(
    page,
    { title: { selector: 'h1', attr: 'text' } },
    { evaluator: '' }
  )
  t.truthy(data)
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
  const extracted = await agent.extract(page, INSTRUCTION, undefined, { text })
  const info = await extracted()
  t.deepEqual(info.rules, page.appliedRules.at(-1))
  t.deepEqual(info.cost, {
    calls: 1,
    inputTokens: 2410,
    outputTokens: 57,
    cachedInputTokens: 1800,
    cacheWriteTokens: 600,
    reasoningTokens: 43,
    usd: 0.0000304,
    generationIds: ['gen_text']
  })
  t.true(info.timing.modelMs >= DELAY_MS - 1)
  t.true(info.timing.totalMs >= info.timing.modelMs)
  t.is(info.timing.otherMs, info.timing.totalMs - info.timing.modelMs)
  t.false('accuracy' in info)
  t.is(await extracted(), info)
})

test('extract from rules alone reports no request and no cost', async t => {
  const extracted = await agent.extract(new Page(), RULES)
  const info = await extracted()
  t.is(info.rules, RULES)
  t.like(info.cost, { calls: 0, inputTokens: 0, outputTokens: 0, usd: 0, generationIds: [] })
  t.is(info.timing.modelMs, 0)
})

test('the page method reports the same information', async t => {
  const page = agent(new Page(), { text: pricedText(JSON.stringify(RULES)) })
  const info = await (await page.extract(INSTRUCTION))()
  t.like(info.cost, { calls: 1, usd: 0.0000304 })
})

test('what extract returns still reads, spreads and serializes as the data', async t => {
  const extracted = await agent.extract(new Page(), RULES)
  t.deepEqual(extracted.toJSON(), DATA)
  t.deepEqual({ ...extracted }, DATA)
  t.deepEqual(Object.keys(extracted), Object.keys(DATA))
  t.is(JSON.stringify(extracted), JSON.stringify(DATA))
  t.is(JSON.stringify({ result: extracted }), JSON.stringify({ result: DATA }))
  for (const key of Object.keys(DATA)) t.deepEqual(extracted[key], DATA[key])
})

const extractedBy = data => agent.extract(new Page(), RULES, { extractor: async () => data })

test('fields named like function properties keep their value and the order of the data', async t => {
  const data = {
    b: 1,
    name: 'BMW X3',
    a: 2,
    length: 3,
    prototype: 4,
    arguments: 5,
    caller: 6,
    call: 7,
    apply: 8,
    bind: 9,
    toString: 10,
    then: 11
  }
  const extracted = await extractedBy(data)
  t.deepEqual(Object.keys(extracted), Object.keys(data))
  t.deepEqual({ ...extracted }, data)
  t.deepEqual(extracted.toJSON(), data)
  t.is(JSON.stringify(extracted), JSON.stringify(data))
  for (const [key, value] of Object.entries(data)) t.is(extracted[key], value)
  t.is((await extracted()).cost.calls, 0)
})

test('a field named toJSON is kept in the serialized and spread-from-toJSON data', async t => {
  const data = { title: 'x', toJSON: 'y' }
  const extracted = await extractedBy(data)
  t.deepEqual(extracted.toJSON(), data)
  t.is(JSON.stringify(extracted), JSON.stringify(data))
})

test('changing a field afterwards changes what is serialized too', async t => {
  const extracted = await extractedBy({ a: 1 })
  extracted.a = 2
  t.is(JSON.stringify(extracted), '{"a":2}')
  t.deepEqual({ ...extracted }, { a: 2 })
})

test('getters and symbol keys of the data are carried over without being read', async t => {
  const tag = Symbol('tag')
  let reads = 0
  const data = {
    [tag]: 'kept',
    get live () {
      reads++
      return reads
    }
  }
  const extracted = await extractedBy(data)
  t.is(reads, 0)
  t.is(extracted[tag], 'kept')
  t.is(extracted.live, 1)
  t.is(extracted.live, 2)
  const throwing = await extractedBy({
    get boom () {
      throw new Error('boom')
    }
  })
  t.throws(() => throwing.boom, { message: 'boom' })
  t.is((await throwing()).cost.calls, 0)
})

test('a frozen result is carried over and stays readable', async t => {
  const extracted = await extractedBy(Object.freeze({ a: 1 }))
  t.is(extracted.a, 1)
  t.deepEqual(extracted.toJSON(), { a: 1 })
})

test('a custom engine result that is not a plain object is reached through toJSON, with info', async t => {
  const list = await extractedBy(['a', 'b'])
  t.deepEqual(list.toJSON(), ['a', 'b'])
  t.is(JSON.stringify(list), '["a","b"]')
  t.deepEqual(Object.keys(list), [])
  const date = await extractedBy(new Date(0))
  t.is(JSON.stringify(date), '"1970-01-01T00:00:00.000Z"')
  const custom = await extractedBy({ a: 1, toJSON: () => ({ custom: true }) })
  t.is(JSON.stringify(custom), '{"custom":true}')
  for (const value of ['text', 42, null, undefined]) {
    const extracted = await extractedBy(value)
    t.is(extracted.toJSON(), value)
    t.is((await extracted()).cost.calls, 0)
  }
})

test('awaiting extract never treats an extracted then field as a promise', async t => {
  const extracted = await extractedBy({ then: 'not a function', title: 'x' })
  t.is(extracted.then, 'not a function')
  t.is(typeof extracted, 'function')
})

test('what an engine throws reaches the caller unchanged, with info when it can carry it', async t => {
  const failing = thrown =>
    agent.extract(new Page(), RULES, {
      extractor: async () => {
        throw thrown
      }
    })
  for (const thrown of ['text', 42, null, undefined, { plain: true }]) {
    t.is(await failing(thrown).catch(error => error), thrown)
  }
  const frozen = Object.freeze(new Error('frozen'))
  t.is(await failing(frozen).catch(error => error), frozen)
  const withOwnInfo = Object.assign(new Error('own'), { info: 'mine' })
  t.is((await failing(withOwnInfo).catch(error => error)).info, 'mine')
  const plain = new Error('plain')
  const caught = await failing(plain).catch(error => error)
  t.is(caught, plain)
  t.is((await caught.info()).rules, RULES)
})

test('rules a model wrote are reported even when the engine then fails', async t => {
  const page = new Page()
  const text = pricedText(JSON.stringify(RULES))
  const extractor = async () => {
    throw new Error('engine down')
  }
  const error = await t.throwsAsync(
    agent.extract(page, INSTRUCTION, undefined, { text, extractor }),
    {
      message: 'engine down'
    }
  )
  const info = await error.info()
  t.deepEqual(info.rules, page.appliedRules.at(-1))
  t.like(info.cost, { calls: 1, usd: 0.0000304 })
})

test('the time of an extraction covers the engine as well as the request', async t => {
  const text = pricedText(JSON.stringify(RULES), { delayMs: DELAY_MS })
  const extractor = async () => {
    await sleep(DELAY_MS)
    return DATA
  }
  const info = await (
    await agent.extract(new Page(), INSTRUCTION, undefined, { text, extractor })
  )()
  t.true(info.timing.totalMs >= 2 * DELAY_MS - 2)
  t.true(info.timing.otherMs >= DELAY_MS - 2)
})

test('a goal result keeps its fields, order and serialization', async t => {
  const models = mockModels(['DONE'])
  const result = await agent.goal(new Page(), GOAL, {
    decisions: models.decisions,
    text: models.text,
    waitMs: 0
  })
  t.deepEqual(Object.keys(result), ['status', 'steps', 'decisions', 'trace'])
  t.deepEqual(JSON.parse(JSON.stringify(result)), JSON.parse(JSON.stringify({ ...result })))
  t.is(result.toJSON().status, 'done')
})

test('an extraction that fails after its request still reports what the request cost', async t => {
  const page = new Page()
  page.data = {}
  const text = pricedText(JSON.stringify(RULES))
  const error = await t.throwsAsync(agent.extract(page, INSTRUCTION, undefined, { text }), {
    message: 'The rules the model wrote matched nothing on the page.'
  })
  const info = await error.info()
  t.like(info.cost, { calls: 1, usd: 0.0000304 })
  t.is(info.rules, undefined)
})

test('an extraction refused before any request reports no cost on its error', async t => {
  const error = await t.throwsAsync(agent.extract(new Page(), { title: 'h1' }))
  t.is((await error.info()).cost.calls, 0)
})

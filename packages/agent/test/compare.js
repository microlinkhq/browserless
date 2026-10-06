'use strict'

const test = require('ava')

const path = require('path')
const os = require('os')
const fs = require('fs')

const compare = require('../scripts/compare')

const SETUP = { decisions: 'typesafe-ai/jev', text: 'openai/gpt-6-luna', reasoning: 'none' }

const info = ({ passed = true, probability = 0.9, usd = 0.001, totalMs = 1000 } = {}) => ({
  accuracy: { passed, probability },
  cost: { calls: 2, inputTokens: 100, outputTokens: 10, usd },
  timing: { totalMs, modelMs: totalMs / 2 }
})

const doneGoal = (overrides = {}) => ({
  goal: 'open it',
  status: 'done',
  trace: [
    { operation: 'CLICK', action: 'e1', confidence: 0.9, pageChanged: true },
    { operation: 'DONE', confidence: 0.7 }
  ],
  info: info(),
  ...overrides
})

const record = (overrides = {}) =>
  compare.toRecord({
    setup: SETUP,
    run: 1,
    goals: [doneGoal()],
    finalUrl: 'https://a.test/',
    ...overrides
  })

test('every decision model is paired with every text model', t => {
  t.deepEqual(compare.setupsFrom({ decisions: 'typesafe-ai/jev,none', text: 'a/one, b/two' }), [
    { decisions: 'typesafe-ai/jev', text: 'a/one', reasoning: 'none' },
    { decisions: 'typesafe-ai/jev', text: 'b/two', reasoning: 'none' },
    { decisions: 'none', text: 'a/one', reasoning: 'none' },
    { decisions: 'none', text: 'b/two', reasoning: 'none' }
  ])
})

test('every reasoning level is one more setup per pair of models', t => {
  t.deepEqual(compare.setupsFrom({ text: 'a/one,b/two', reasoning: 'none, low' }), [
    { decisions: 'typesafe-ai/jev', text: 'a/one', reasoning: 'none' },
    { decisions: 'typesafe-ai/jev', text: 'a/one', reasoning: 'low' },
    { decisions: 'typesafe-ai/jev', text: 'b/two', reasoning: 'none' },
    { decisions: 'typesafe-ai/jev', text: 'b/two', reasoning: 'low' }
  ])
  t.throws(() => compare.setupsFrom({ reasoning: true }), { message: /^--reasoning needs a value/ })
  t.is(
    compare.setupsFrom({ decisions: 'a/x,none', text: 'a/one,b/two', reasoning: 'none,low,high' })
      .length,
    12
  )
})

test('a reasoning level given twice is one setup and an unknown level is refused before any run', t => {
  t.deepEqual(
    compare.setupsFrom({ reasoning: 'low,low, none' }).map(setup => setup.reasoning),
    ['low', 'none']
  )
  t.throws(() => compare.setupsFrom({ reasoning: 'none,LOW' }), {
    message: /^--reasoning LOW is not one of: provider-default, none, minimal, low/
  })
})

test('setups whose names would read the same when joined stay separate', t => {
  const records = [
    compare.toRecord({
      setup: { decisions: 'a + b', text: 'c', reasoning: 'none' },
      run: 1,
      goals: [doneGoal()]
    }),
    compare.toRecord({
      setup: { decisions: 'a', text: 'b + c', reasoning: 'none' },
      run: 1,
      goals: [doneGoal()]
    })
  ]
  t.is(compare.summarize(records).length, 2)
})

test('the reasoning level reaches the agent and the record, and splits the ranking', t => {
  const low = { ...SETUP, reasoning: 'low' }
  t.is(compare.agentOptions(low).reasoning, 'low')
  const records = [
    compare.toRecord({ setup: SETUP, run: 1, goals: [doneGoal()] }),
    compare.toRecord({ setup: low, run: 1, goals: [doneGoal({ status: 'no_change' })] })
  ]
  t.deepEqual(
    records.map(({ reasoning }) => reasoning),
    ['none', 'low']
  )
  t.deepEqual(
    compare
      .summarize(records)
      .map(({ reasoning, runs, doneRate }) => ({ reasoning, runs, doneRate })),
    [
      { reasoning: 'none', runs: 1, doneRate: 1 },
      { reasoning: 'low', runs: 1, doneRate: 0 }
    ]
  )
})

test('the cost that was reported is kept apart from the total, with the runs that gave none', t => {
  const records = [
    finished('a', { usd: 0.1 }),
    finished('a', { usd: 0.2 }),
    finished('a', { usd: undefined, status: 'error' }),
    finished('b', { usd: 0.4 })
  ]
  const task = { url: 'https://a.test', goals: ['x'], runs: 3 }
  const result = compare.report(task, 'out.jsonl', records)
  t.like(result, { totalUsd: undefined, reportedUsd: 0.7, runsWithoutCost: 1 })
  const a = result.ranking.find(setup => setup.text === 'a')
  const b = result.ranking.find(setup => setup.text === 'b')
  t.like(a, { totalUsd: undefined, reportedUsd: 0.3, runsWithoutCost: 1 })
  t.like(b, { totalUsd: 0.4, reportedUsd: 0.4, runsWithoutCost: 0 })
})

test('without model flags the one setup is the package defaults', t => {
  t.deepEqual(compare.setupsFrom({}), [SETUP])
})

test('none as the decision model lets the language model decide', t => {
  t.deepEqual(compare.agentOptions({ decisions: 'none', text: 'a/one', reasoning: 'low' }), {
    decisions: false,
    text: 'a/one',
    reasoning: 'low'
  })
  t.deepEqual(compare.agentOptions(SETUP), SETUP)
})

test('a goal is never split on its commas and repeated goals keep their order', t => {
  const task = compare.taskFrom({
    url: 'https://a.test',
    goal: ['search bmw, x3', 'sort'],
    runs: '2'
  })
  t.deepEqual(task.goals, ['search bmw, x3', 'sort'])
  t.is(task.runs, 2)
})

test('a task needs a url, a goal and a positive run count', t => {
  t.throws(() => compare.taskFrom({ goal: 'x' }), { message: /^Usage: browserless exec/ })
  t.throws(() => compare.taskFrom({ url: 'https://a.test' }), {
    message: /^Usage: browserless exec/
  })
  t.throws(() => compare.taskFrom({ url: 'https://a.test', goal: 'x', runs: 0 }), {
    message: 'runs must be an integer of at least 1.'
  })
})

test('a record adds up its goals and keeps the lowest confidence', t => {
  const second = doneGoal({
    trace: [
      { operation: 'TYPE_TEXT', action: 'e2', text: 'bmw', confidence: 0.4, pageChanged: false },
      { operation: 'CLICK', action: 'e9', stale: true, confidence: 0.8 },
      { operation: 'DONE', confidence: 0.6 }
    ],
    info: info({ probability: 0.6, usd: 0.002, totalMs: 500 })
  })
  t.like(record({ goals: [doneGoal(), second] }), {
    status: 'done',
    goalsDone: 2,
    decisionRequests: 5,
    staleDecisions: 1,
    actionsWithoutPageChange: 1,
    path: 'CLICK e1 > DONE | TYPE_TEXT e2 "bmw" > DONE',
    minConfidence: 0.4,
    passed: true,
    probability: 0.6,
    calls: 4,
    inputTokens: 200,
    usd: 0.003,
    totalMs: 1500
  })
})

test('a failed goal gives the record its reason and leaves it unjudged', t => {
  const blocked = {
    goal: 'sort',
    status: 'step_budget',
    error: 'BlockedError: Decision-request budget exhausted.',
    trace: [{ operation: 'WAIT' }],
    info: {
      cost: { calls: 1, inputTokens: 50, outputTokens: 5, usd: 0.0005 },
      timing: { totalMs: 300, modelMs: 200 }
    }
  }
  const failed = record({ goals: [doneGoal(), blocked] })
  t.like(failed, { status: 'step_budget', goalsDone: 1, error: blocked.error, usd: 0.0015 })
  t.is(failed.passed, undefined)
  t.is(failed.minConfidence, 0.7)
})

test('a cost one goal did not report is unknown for the whole run, not a partial sum', t => {
  const unpriced = doneGoal({ info: { ...info(), cost: { calls: 1 } } })
  const partial = record({ goals: [doneGoal(), unpriced] })
  t.is(partial.usd, undefined)
  t.is(partial.inputTokens, undefined)
  t.is(partial.calls, 3)
})

test('an extraction is recorded by how much it returned and a hash of it', t => {
  const data = {
    products: [
      { name: 'a', price: 1 },
      { name: 'b', price: null }
    ]
  }
  const same = record({ extraction: { data, ms: 40 } })
  const other = record({ extraction: { data: { products: [] }, ms: 40 } })
  t.like(same, { extracted: true, extractMs: 40, dataValues: 3 })
  t.is(same.dataHash, record({ extraction: { data, ms: 99 } }).dataHash)
  t.not(same.dataHash, other.dataHash)
  t.like(record({ extraction: { error: 'TypeError: nothing', ms: 5 } }), {
    extracted: false,
    extractError: 'TypeError: nothing',
    dataValues: 0
  })
  t.false('extracted' in record())
})

test('p90 is the value that nine in ten runs do not exceed', t => {
  const oneToTen = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
  t.is(compare.percentile(oneToTen, 0.9), 9)
  t.is(compare.percentile([...oneToTen, 11], 0.9), 10)
  t.is(compare.percentile([300, 100, 200], 0.9), 300)
  t.is(compare.percentile([42], 0.9), 42)
  t.is(compare.percentile([], 0.9), undefined)
})

test('a setup with a faster median but a slower p90 ranks after the steadier one', t => {
  const spiky = [100, 100, 100, 100, 9000].map(totalMs => finished('spiky', { totalMs }))
  const steady = [500, 500, 500, 500, 500].map(totalMs => finished('steady', { totalMs }))
  t.deepEqual(ranked([...spiky, ...steady]), ['steady', 'spiky'])
})

test('the median of an even count is the mean of the middle two', t => {
  t.is(compare.median([5, 1, 3]), 3)
  t.is(compare.median([4, 1, 3, 2]), 2.5)
  t.is(compare.median([]), undefined)
})

const finished = (text, overrides = {}) => ({ ...record(), text, ...overrides })

const ranked = records => compare.summarize(records).map(setup => setup.text)

test('a higher done rate ranks first even when every later measure is worse', t => {
  t.deepEqual(
    ranked([
      finished('finishes', { passed: false, path: 'A', totalMs: 9000, usd: 9 }),
      finished('finishes', { passed: false, path: 'B', totalMs: 9000, usd: 9 }),
      finished('half', { totalMs: 1, usd: 0 }),
      finished('half', { status: 'no_change', passed: undefined })
    ]),
    ['finishes', 'half']
  )
})

test('with equal done rates the higher pass rate ranks first', t => {
  t.deepEqual(
    ranked([
      finished('unsure', { passed: false, totalMs: 1, usd: 0 }),
      finished('judged met', { path: 'A', totalMs: 9000, usd: 9 }),
      finished('judged met', { path: 'B', totalMs: 9000, usd: 9 }),
      finished('unsure', { totalMs: 1, usd: 0 })
    ]),
    ['judged met', 'unsure']
  )
})

test('with equal done and pass rates the higher path agreement ranks first', t => {
  t.deepEqual(
    ranked([
      finished('wanders', { path: 'A', totalMs: 1, usd: 0 }),
      finished('wanders', { path: 'B', totalMs: 1, usd: 0 }),
      finished('steady', { totalMs: 9000, usd: 9 }),
      finished('steady', { totalMs: 9000, usd: 9 })
    ]),
    ['steady', 'wanders']
  )
})

test('with equal rates and agreement the faster ranks first, then the cheaper', t => {
  t.deepEqual(
    ranked([
      finished('slow', { totalMs: 3000, usd: 0 }),
      finished('fast', { totalMs: 1000, usd: 9 })
    ]),
    ['fast', 'slow']
  )
  t.deepEqual(ranked([finished('dear', { usd: 0.002 }), finished('cheap', { usd: 0.001 })]), [
    'cheap',
    'dear'
  ])
})

test('medians, p90 and path agreement cover finished runs only; total cost and stale decisions cover all', t => {
  const [summary] = compare.summarize([
    finished('a', { totalMs: 1000, decisionRequests: 2, usd: 0.001, staleDecisions: 1 }),
    finished('a', { totalMs: 3000, decisionRequests: 4, usd: 0.003, staleDecisions: 0 }),
    finished('a', {
      status: 'step_budget',
      passed: undefined,
      path: 'Z',
      totalMs: 90000,
      decisionRequests: 120,
      usd: 0.9,
      staleDecisions: 5
    })
  ])
  t.like(summary, {
    runs: 3,
    doneRate: 0.67,
    judgedRuns: 2,
    passRate: 0.67,
    pathAgreement: 1,
    distinctPaths: 1,
    medianDecisionRequests: 3,
    p90TotalMs: 3000,
    medianUsd: 0.002,
    totalUsd: 0.904,
    staleDecisions: 6,
    failures: { step_budget: 1 }
  })
})

test('p90 over ten finished runs is the ninth fastest, not the slowest', t => {
  const times = [1000, 900, 800, 700, 600, 500, 400, 300, 200, 100]
  const [summary] = compare.summarize(times.map(totalMs => finished('a', { totalMs })))
  t.is(summary.p90TotalMs, 900)
})

test('p90 is unknown when a finished run did not report its time', t => {
  const [summary] = compare.summarize([
    finished('a', { totalMs: 1000 }),
    finished('a', { totalMs: undefined })
  ])
  t.is(summary.p90TotalMs, undefined)
  t.is(compare.summarize([finished('a', { status: 'no_change' })])[0].p90TotalMs, undefined)
})

test('total cost is rounded and never includes a number that is not finite', t => {
  const totalOf = costs => compare.summarize(costs.map(usd => finished('a', { usd })))[0].totalUsd
  t.is(totalOf([0.1, 0.2]), 0.3)
  t.is(totalOf([0.1, NaN]), undefined)
  t.is(totalOf([0.1, Infinity]), undefined)
  t.is(totalOf([0, 0]), 0)
})

test('the cost of the whole comparison adds every setup, or is unknown when one is', t => {
  const task = { url: 'https://a.test', goals: ['x'], runs: 1 }
  const costOf = records => compare.report(task, 'out.jsonl', records).totalUsd
  t.is(costOf([finished('a', { usd: 0.1 }), finished('b', { usd: 0.2 })]), 0.3)
  t.is(costOf([finished('a', { usd: 0.1 }), finished('b', { usd: undefined })]), undefined)
  t.like(compare.report(task, 'out.jsonl', [finished('a')]), {
    url: 'https://a.test',
    goals: ['x'],
    runsPerSetup: 1,
    file: 'out.jsonl'
  })
})

test('a median is unknown when a finished run did not report the number', t => {
  const [summary] = compare.summarize([
    finished('a', { usd: 0.001 }),
    finished('a', { usd: undefined })
  ])
  t.is(summary.medianUsd, undefined)
  t.is(summary.p90TotalMs, 1000)
  t.is(summary.totalUsd, undefined)
})

test('a run passes only when every goal was judged met', t => {
  const unmet = doneGoal({ info: info({ passed: false, probability: 0.2 }) })
  t.like(record({ goals: [doneGoal(), unmet] }), { passed: false, probability: 0.2, modelMs: 1000 })
  const unjudged = doneGoal({ info: { ...info(), accuracy: undefined } })
  t.is(record({ goals: [doneGoal(), unjudged] }).passed, undefined)
})

test('a run that did not finish is never counted as passed', t => {
  const blockedButJudgedMet = { goal: 'sort', status: 'step_budget', trace: [], info: info() }
  const failed = record({ goals: [blockedButJudgedMet] })
  t.is(failed.passed, undefined)
  t.like(compare.summarize([failed])[0], { doneRate: 0, judgedRuns: 0, passRate: 0 })
})

test('the lowest confidence also looks at the confidence in the chosen target', t => {
  const goal = doneGoal({
    trace: [{ operation: 'CLICK', action: 'e1', confidence: 0.9, targetConfidence: 0.3 }]
  })
  t.is(record({ goals: [goal] }).minConfidence, 0.3)
})

test('the cost of the extraction request is part of the run cost and is also kept apart', t => {
  const extractInfo = { cost: { calls: 1, inputTokens: 40, outputTokens: 4, usd: 0.0004 } }
  const withExtraction = record({ extraction: { data: { a: 1 }, ms: 9, info: extractInfo } })
  t.like(withExtraction, {
    calls: 3,
    inputTokens: 140,
    outputTokens: 14,
    usd: 0.0014,
    extractUsd: 0.0004,
    totalMs: 1000
  })
  const failed = record({ extraction: { error: 'TypeError: nothing', ms: 9, info: extractInfo } })
  t.like(failed, { extracted: false, usd: 0.0014, extractUsd: 0.0004 })
  const unreported = record({ extraction: { data: { a: 1 }, ms: 9 } })
  t.is(unreported.usd, undefined)
  t.is(unreported.extractUsd, undefined)
  t.is(record().usd, 0.001)
})

test('the data hash does not depend on key order and empty data is not an extraction', t => {
  const hashOf = data => record({ extraction: { data, ms: 1 } }).dataHash
  t.is(hashOf({ a: 1, b: [{ c: 2, d: 3 }] }), hashOf({ b: [{ d: 3, c: 2 }], a: 1 }))
  t.not(hashOf({ a: [1, 2] }), hashOf({ a: [2, 1] }))
  t.like(record({ extraction: { data: { products: [] }, ms: 1 } }), {
    extracted: false,
    dataValues: 0
  })
})

test('a run that could not start is an error record and keeps the navigation error apart', t => {
  t.like(compare.toRecord({ setup: SETUP, run: 3, runError: 'Error: no browser' }), {
    status: 'error',
    error: 'Error: no browser',
    goalsDone: 0,
    decisionRequests: 0,
    path: ''
  })
  t.is(compare.toRecord({ setup: SETUP, run: 3, runError: 'x' }).passed, undefined)
  t.is(compare.toRecord({ setup: SETUP, run: 3, runError: 'x' }).usd, undefined)
  t.is(
    compare.toRecord({ setup: SETUP, run: 3, runError: 'x', goals: [doneGoal()] }).usd,
    undefined
  )
  t.is(record({ navigationError: 'TimeoutError: slow' }).navigationError, 'TimeoutError: slow')
  t.is(record({ navigationError: 'TimeoutError: slow' }).status, 'done')
})

test('flags without a value are refused instead of becoming model ids or goals', t => {
  const task = { url: 'https://a.test', goal: 'x' }
  t.throws(() => compare.setupsFrom({ decisions: true }), { message: /^--decisions needs a value/ })
  t.throws(() => compare.setupsFrom({ text: false }), { message: /^--text needs a value/ })
  t.throws(() => compare.taskFrom({ ...task, goal: true }), { message: /^--goal needs a value/ })
  t.throws(() => compare.taskFrom({ ...task, goal: { x: 1 } }), {
    message: /^--goal needs a value/
  })
  t.throws(() => compare.taskFrom({ ...task, url: ['a', 'b'] }), { message: /^Usage/ })
  t.throws(() => compare.taskFrom({ ...task, extract: true }), {
    message: /^--extract needs one value/
  })
  t.throws(() => compare.taskFrom({ ...task, runs: true }), { message: /^runs must be/ })
  t.is(compare.taskFrom({ ...task, runs: 3 }).runs, 3)
})

test('a model list with no id in it is refused', t => {
  t.throws(() => compare.setupsFrom({ text: ',' }), { message: /^--text needs a value/ })
})

test('a model id given twice is one setup', t => {
  t.deepEqual(compare.setupsFrom({ text: 'a/one,a/one', decisions: ['none', 'none'] }), [
    { decisions: 'none', text: 'a/one', reasoning: 'none' }
  ])
})

test('runs that cannot start are recorded and the remaining runs still happen', async t => {
  const out = path.join(os.tmpdir(), `compare-test-${process.pid}-${Date.now()}.jsonl`)
  t.teardown(() => fs.rmSync(out, { force: true }))
  let attempts = 0
  const browserless = {
    browser: async () => {
      attempts++
      throw new Error('no browser')
    }
  }
  const opts = { url: 'https://a.test', goal: 'x', text: 'a/one,b/two', runs: 2, out }
  const result = await compare({ browserless, opts })
  const written = fs.readFileSync(out, 'utf8').trim().split('\n').map(JSON.parse)
  t.is(attempts, 4)
  t.is(result.file, out)
  t.like(result, { totalUsd: undefined, reportedUsd: 0, runsWithoutCost: 4 })
  t.deepEqual(
    written.map(({ text, run, status, error }) => ({ text, run, status, error })),
    ['a/one', 'b/two', 'a/one', 'b/two'].map((text, index) => ({
      text,
      run: index < 2 ? 1 : 2,
      status: 'error',
      error: 'Error: no browser'
    }))
  )
  t.like(result.ranking[0], { runs: 2, doneRate: 0, failures: { error: 2 } })
})

test('an output file that cannot be written fails before any run', async t => {
  let started = false
  const browserless = {
    browser: async () => {
      started = true
    }
  }
  const opts = {
    url: 'https://a.test',
    goal: 'x',
    out: path.join(os.tmpdir(), 'missing-dir', 'x', 'out.jsonl')
  }
  await t.throwsAsync(compare({ browserless, opts }), { code: 'ENOENT' })
  t.false(started)
})

test('path and data agreement are the share of runs on the most common value', t => {
  const [summary] = compare.summarize([
    { ...record(), path: 'A', extracted: true, dataHash: 'x' },
    { ...record(), path: 'A', extracted: true, dataHash: 'x' },
    { ...record(), path: 'A', extracted: true, dataHash: 'y' },
    { ...record(), path: 'B', extracted: false }
  ])
  t.like(summary, { pathAgreement: 0.75, distinctPaths: 2, extractRate: 0.75, dataAgreement: 0.67 })
})

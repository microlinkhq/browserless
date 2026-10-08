'use strict'

const test = require('ava')
const model = require('../src/model')

const EVALUATION_CALL = {
  kind: 'evaluation',
  ms: 7,
  inputTokens: 320,
  outputTokens: 31,
  usd: 0.00001344,
  generationId: 'gen_evaluation'
}
const GOAL_CALL = {
  kind: 'decision',
  ms: 11,
  inputTokens: 3126,
  outputTokens: 206,
  usd: 0.000131292,
  generationId: 'gen_decision'
}

let attempts = 0
model.evaluateGoal = async (request, evaluator, options) => {
  attempts++
  options.onCall(EVALUATION_CALL)
  if (attempts === 1) throw new Error('aborted after the reply was billed')
  return { passed: true, probability: 0.92 }
}
const { createProfiling } = require('../src/profiling')

test('an evaluation billed before it failed stays in cost and timing, also after a retry', async t => {
  const info = createProfiling({
    goal: 'open the comments',
    state: { url: 'https://example.com', title: 'HN', text: 'comments', actions: [] },
    trace: [],
    calls: [GOAL_CALL],
    totalMs: 40,
    evaluator: 'typesafe-ai/jev',
    timeout: 1000
  })
  const failed = await info()
  t.regex(failed.error.message, /billed/)
  t.is(failed.cost.calls, 2)
  t.is(failed.cost.usd, 0.000144732)
  t.is(failed.timing.evaluationMs, 7)
  const retried = await info()
  t.deepEqual(retried.accuracy, { passed: true, probability: 0.92 })
  t.is(retried.cost.calls, 3)
  t.is(retried.cost.usd, 0.000158172)
  t.deepEqual(retried.cost.generationIds, ['gen_decision', 'gen_evaluation', 'gen_evaluation'])
  t.is(retried.timing.evaluationMs, 14)
})

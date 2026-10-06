'use strict'

const { evaluateGoal, evaluationRequest } = require('./model')

const USD_DECIMALS = 12

const TOKEN_KEYS = ['inputTokens', 'outputTokens']

const BREAKDOWN_KEYS = ['cachedInputTokens', 'cacheWriteTokens', 'reasoningTokens']

const total = (calls, key) => calls.reduce((sum, call) => sum + (call[key] ?? 0), 0)

const reportedTotal = (calls, key) =>
  calls.every(call => call[key] !== undefined) ? total(calls, key) : undefined

const costOf = calls => {
  const usd = reportedTotal(calls, 'usd')
  return {
    calls: calls.length,
    ...Object.fromEntries(TOKEN_KEYS.map(key => [key, reportedTotal(calls, key)])),
    ...Object.fromEntries(BREAKDOWN_KEYS.map(key => [key, total(calls, key)])),
    usd: usd === undefined ? undefined : Number(usd.toFixed(USD_DECIMALS)),
    generationIds: calls.map(call => call.generationId).filter(Boolean)
  }
}

const timingOf = (calls, evaluationCalls, totalMs) => {
  const modelMs = total(calls, 'ms')
  return {
    totalMs,
    modelMs,
    otherMs: Math.max(0, totalMs - modelMs),
    evaluationMs: total(evaluationCalls, 'ms')
  }
}

const createInfo = ({ goal, state, trace, calls, totalMs, evaluator, timeout }) => {
  const goalCalls = [...calls]
  const request = state && evaluationRequest(state, goal, trace)
  const evaluationCalls = []
  let result
  const evaluate = async signal => {
    if (!request) return {}
    try {
      const accuracy = await evaluateGoal(request, evaluator, {
        timeout,
        signal,
        onCall: metrics => evaluationCalls.push(metrics)
      })
      return { accuracy }
    } catch (error) {
      return { error }
    }
  }
  const report = ({ accuracy, error }) => ({
    accuracy,
    cost: costOf([...goalCalls, ...evaluationCalls]),
    timing: timingOf(goalCalls, evaluationCalls, totalMs),
    ...(error && { error })
  })
  return ({ signal } = {}) => {
    if (!result) {
      const pending = evaluate(signal).then(outcome => {
        if (outcome.error && result === pending) result = undefined
        return report(outcome)
      })
      result = pending
    }
    return result
  }
}

module.exports = { createInfo, costOf, timingOf }

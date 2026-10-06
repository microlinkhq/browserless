'use strict'

const debug = require('debug-logfmt')('browserless:agent:compare')
const { createHash } = require('crypto')
const path = require('path')
const os = require('os')
const fs = require('fs')

const { REASONING_LEVELS } = require('../src/model')
const agent = require('..')

const DEFAULT_DECISIONS = 'typesafe-ai/jev'
const DEFAULT_TEXT = 'openai/gpt-6-luna'
const DEFAULT_REASONING = 'none'
const DEFAULT_RUNS = 5
const LANGUAGE_MODEL_DECIDES = 'none'
const DONE = 'done'
const UNEXPECTED_ERROR = 'error'
const HASH_LENGTH = 12
const RATE_DECIMALS = 2
const USD_DECIMALS = 6
const NINETIETH = 0.9
const USAGE =
  'Usage: browserless exec scripts/compare.js --url=<url> --goal=<goal> [--goal=<next goal>] [--extract=<what to get>] [--decisions=<id>,none] [--text=<id>,<id>] [--reasoning=none,low] [--runs=5] [--out=<file.jsonl>]'

const isText = value => typeof value === 'string' && value.trim() !== ''

const textsOf = (value, flag) => {
  const values = value === undefined ? [] : [value].flat()
  if (!values.every(isText)) throw new TypeError(`--${flag} needs a value. ${USAGE}`)
  return values
}

const optionalText = (value, flag) => {
  if (value !== undefined && !isText(value)) {
    throw new TypeError(`--${flag} needs one value. ${USAGE}`)
  }
  return value
}

const modelIds = (value, flag, fallback) => {
  const ids = textsOf(value ?? fallback, flag)
    .flatMap(item => item.split(','))
    .map(item => item.trim())
    .filter(Boolean)
  if (ids.length === 0) throw new TypeError(`--${flag} needs a value. ${USAGE}`)
  return [...new Set(ids)]
}

const reasoningLevels = reasoning => {
  const levels = modelIds(reasoning, 'reasoning', DEFAULT_REASONING)
  const unknown = levels.find(level => !REASONING_LEVELS.includes(level))
  if (unknown !== undefined) {
    throw new TypeError(`--reasoning ${unknown} is not one of: ${REASONING_LEVELS.join(', ')}.`)
  }
  return levels
}

const setupsFrom = ({ decisions, text, reasoning }) =>
  modelIds(decisions, 'decisions', DEFAULT_DECISIONS).flatMap(decisionModel =>
    modelIds(text, 'text', DEFAULT_TEXT).flatMap(textModel =>
      reasoningLevels(reasoning).map(level => ({
        decisions: decisionModel,
        text: textModel,
        reasoning: level
      }))
    )
  )

const runCount = runs => {
  const count = typeof runs === 'number' || isText(runs) ? Number(runs) : NaN
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new TypeError('runs must be an integer of at least 1.')
  }
  return count
}

const taskFrom = ({ url, goal, extract, runs = DEFAULT_RUNS }) => {
  const goals = textsOf(goal, 'goal')
  if (!isText(url) || goals.length === 0) throw new TypeError(USAGE)
  return { url, goals, extract: optionalText(extract, 'extract'), runs: runCount(runs) }
}

const agentOptions = setup => ({
  decisions: setup.decisions === LANGUAGE_MODEL_DECIDES ? false : setup.decisions,
  text: setup.text,
  reasoning: setup.reasoning
})

const sum = values => values.reduce((total, value) => total + value, 0)

const sumWhenAllReported = values => (values.every(Number.isFinite) ? sum(values) : undefined)

const median = values => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}

const percentile = (values, fraction) => {
  if (values.length === 0) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]
}

const rounded = (value, decimals) =>
  value === undefined ? undefined : Number(value.toFixed(decimals))

const rate = (count, of) => (of === 0 ? undefined : rounded(count / of, RATE_DECIMALS))

const counts = values =>
  values.reduce((tally, value) => ({ ...tally, [value]: (tally[value] ?? 0) + 1 }), {})

const mostCommonShare = values =>
  values.length === 0 ? undefined : rate(Math.max(...Object.values(counts(values))), values.length)

const describeEntry = entry =>
  [entry.operation, entry.action, entry.text === undefined ? undefined : JSON.stringify(entry.text)]
    .filter(Boolean)
    .join(' ')

const pathOf = goals =>
  goals
    .map(goal =>
      goal.trace
        .filter(entry => !entry.stale)
        .map(describeEntry)
        .join(' > ')
    )
    .join(' | ')

const withSortedKeys = value => {
  if (Array.isArray(value)) return value.map(withSortedKeys)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map(key => [key, withSortedKeys(value[key])])
  )
}

const digest = value =>
  createHash('sha256')
    .update(JSON.stringify(withSortedKeys(value)))
    .digest('hex')
    .slice(0, HASH_LENGTH)

const countLeaves = value => {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value !== 'object') return 1
  return sum(Object.values(value).map(countLeaves))
}

const lowest = values => {
  const finite = values.filter(Number.isFinite)
  return finite.length > 0 ? Math.min(...finite) : undefined
}

const isJudged = accuracy =>
  typeof accuracy?.passed === 'boolean' && Number.isFinite(accuracy.probability)

const accuracyOf = (goals, status) => {
  const judged = goals.map(goal => goal.info?.accuracy).filter(isJudged)
  if (status !== DONE || judged.length < goals.length) return {}
  return {
    passed: judged.every(accuracy => accuracy.passed),
    probability: lowest(judged.map(accuracy => accuracy.probability))
  }
}

const statusOf = (goals, runError) => {
  if (runError || goals.length === 0) return UNEXPECTED_ERROR
  return goals.find(goal => goal.status !== DONE)?.status ?? DONE
}

const extractionFields = ({ data, error, ms, info }) => {
  const dataValues = countLeaves(data)
  return {
    extracted: error === undefined && dataValues > 0,
    ...(error && { extractError: error }),
    extractMs: ms,
    extractUsd: rounded(info?.cost?.usd, USD_DECIMALS),
    dataValues,
    dataHash: data === undefined ? undefined : digest(data)
  }
}

const toRecord = ({ setup, run, goals = [], extraction, finalUrl, navigationError, runError }) => {
  const trace = goals.flatMap(goal => goal.trace)
  const infos = goals.map(goal => goal.info ?? {})
  const status = statusOf(goals, runError)
  const error = runError ?? goals.find(goal => goal.status !== DONE)?.error
  const requestInfos = extraction ? [...infos, extraction.info ?? {}] : infos
  const reportedBy = (reporters, read) =>
    runError ? undefined : sumWhenAllReported(reporters.map(read))
  return {
    decisions: setup.decisions,
    text: setup.text,
    reasoning: setup.reasoning,
    run,
    status,
    ...(error && { error }),
    ...(navigationError && { navigationError }),
    goalsDone: goals.filter(goal => goal.status === DONE).length,
    decisionRequests: trace.length,
    staleDecisions: trace.filter(entry => entry.stale).length,
    actionsWithoutPageChange: trace.filter(entry => entry.pageChanged === false).length,
    path: pathOf(goals),
    minConfidence: lowest(trace.flatMap(entry => [entry.confidence, entry.targetConfidence])),
    ...accuracyOf(goals, status),
    calls: sum(requestInfos.map(info => info.cost?.calls ?? 0)),
    inputTokens: reportedBy(requestInfos, info => info.cost?.inputTokens),
    outputTokens: reportedBy(requestInfos, info => info.cost?.outputTokens),
    usd: rounded(
      reportedBy(requestInfos, info => info.cost?.usd),
      USD_DECIMALS
    ),
    totalMs: reportedBy(infos, info => info.timing?.totalMs),
    modelMs: reportedBy(infos, info => info.timing?.modelMs),
    finalUrl,
    ...(extraction && extractionFields(extraction))
  }
}

const reportedCost = records => {
  const reported = records.map(record => record.usd).filter(Number.isFinite)
  return {
    reportedUsd: rounded(sum(reported), USD_DECIMALS),
    runsWithoutCost: records.length - reported.length
  }
}

const summarizeSetup = records => {
  const done = records.filter(record => record.status === DONE)
  const judged = records.filter(record => record.passed !== undefined)
  const extracted = records.filter(record => record.extracted)
  const ofDone = (key, measure) => {
    const values = done.map(record => record[key])
    return values.every(Number.isFinite) ? measure(values) : undefined
  }
  return {
    decisions: records[0].decisions,
    text: records[0].text,
    reasoning: records[0].reasoning,
    runs: records.length,
    doneRate: rate(done.length, records.length),
    judgedRuns: judged.length,
    passRate: rate(judged.filter(record => record.passed).length, records.length),
    pathAgreement: mostCommonShare(done.map(record => record.path)),
    distinctPaths: new Set(done.map(record => record.path)).size,
    medianDecisionRequests: ofDone('decisionRequests', median),
    p90TotalMs: ofDone('totalMs', values => percentile(values, NINETIETH)),
    medianUsd: rounded(ofDone('usd', median), USD_DECIMALS),
    totalUsd: rounded(sumWhenAllReported(records.map(record => record.usd)), USD_DECIMALS),
    ...reportedCost(records),
    staleDecisions: sum(records.map(record => record.staleDecisions)),
    failures: counts(records.filter(record => record.status !== DONE).map(record => record.status)),
    ...(records.some(record => record.extracted !== undefined) && {
      extractRate: rate(extracted.length, records.length),
      dataAgreement: mostCommonShare(extracted.map(record => record.dataHash))
    })
  }
}

const descending = (a = -Infinity, b = -Infinity) => b - a
const ascending = (a = Infinity, b = Infinity) => a - b

const betterFirst = (a, b) =>
  descending(a.doneRate, b.doneRate) ||
  descending(a.passRate, b.passRate) ||
  descending(a.pathAgreement, b.pathAgreement) ||
  ascending(a.p90TotalMs, b.p90TotalMs) ||
  ascending(a.medianUsd, b.medianUsd)

const setupKey = record => JSON.stringify([record.decisions, record.text, record.reasoning])

const summarize = records =>
  Object.values(Object.groupBy(records, setupKey)).map(summarizeSetup).sort(betterFirst)

const report = (task, file, records) => {
  const ranking = summarize(records)
  return {
    url: task.url,
    goals: task.goals,
    runsPerSetup: task.runs,
    file,
    totalUsd: rounded(sumWhenAllReported(ranking.map(setup => setup.totalUsd)), USD_DECIMALS),
    ...reportedCost(records),
    ranking
  }
}

const messageOf = error =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error)

const infoOf = error => (typeof error?.info === 'function' ? error.info() : undefined)

const measureGoal = async (page, goal, options) => {
  try {
    const result = await agent.goal(page, goal, options)
    return { goal, status: result.status, trace: result.trace, info: await result() }
  } catch (error) {
    return {
      goal,
      status: error?.reason ?? UNEXPECTED_ERROR,
      error: messageOf(error),
      trace: error?.trace ?? [],
      info: await infoOf(error)
    }
  }
}

const measureExtraction = async (page, instruction, options) => {
  const started = performance.now()
  const outcome = await agent.extract(page, instruction, undefined, options).then(
    async extracted => ({ data: extracted.toJSON(), info: await extracted() }),
    async error => ({ error: messageOf(error), info: await infoOf(error) })
  )
  return { ...outcome, ms: Math.round(performance.now() - started) }
}

const measureTask = async (browserless, page, task, setup) => {
  const { error } = await browserless.goto(page, { url: task.url })
  const options = agentOptions(setup)
  const goals = []
  for (const goal of task.goals) {
    goals.push(await measureGoal(page, goal, options))
    if (goals.at(-1).status !== DONE) break
  }
  const reachedTheEnd = goals.length === task.goals.length && goals.at(-1).status === DONE
  const extraction =
    task.extract && reachedTheEnd ? await measureExtraction(page, task.extract, options) : undefined
  return {
    goals,
    extraction,
    finalUrl: page.url(),
    ...(error && { navigationError: messageOf(error) })
  }
}

const inFreshContext = async (browserless, use) => {
  const browser = await browserless.browser()
  const context = await browser.createBrowserContext()
  try {
    return await use(await context.newPage())
  } finally {
    await context.close().catch(() => {})
  }
}

const measureRun = (browserless, task, setup, run) =>
  inFreshContext(browserless, page => measureTask(browserless, page, task, setup)).then(
    measured => toRecord({ setup, run, ...measured }),
    error => toRecord({ setup, run, runError: messageOf(error) })
  )

const defaultOutputFile = () =>
  path.join(os.tmpdir(), `browserless-agent-compare-${Date.now()}.jsonl`)

const writableFile = out => {
  const file = path.resolve(optionalText(out, 'out') ?? defaultOutputFile())
  fs.appendFileSync(file, '')
  return file
}

module.exports = async ({ browserless, opts }) => {
  const task = taskFrom(opts)
  const setups = setupsFrom(opts)
  const file = writableFile(opts.out)
  debug('start', { file, setups: setups.length, runsPerSetup: task.runs })
  const records = []
  for (let run = 1; run <= task.runs; run++) {
    for (const setup of setups) {
      const record = await measureRun(browserless, task, setup, run)
      records.push(record)
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`)
      debug('run', record)
    }
  }
  return report(task, file, records)
}

module.exports.setupsFrom = setupsFrom
module.exports.taskFrom = taskFrom
module.exports.agentOptions = agentOptions
module.exports.toRecord = toRecord
module.exports.summarize = summarize
module.exports.report = report
module.exports.median = median
module.exports.percentile = percentile

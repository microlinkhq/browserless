'use strict'

const {
  experimental_decide: decideWithModel,
  gateway,
  generateText,
  Output,
  jsonSchema,
  NoObjectGeneratedError,
  NoOutputGeneratedError
} = require('ai')

const {
  NEXT_ACTION,
  TARGET,
  TEXT_VALUE,
  LANGUAGE_DECISION,
  RULES_WRITER,
  GOAL_EVALUATION
} = require('./questions')
const { BlockedError } = require('./errors')

const PROBABILITY_SUM_TOLERANCE = 0.02
const WINNER_TOLERANCE = 1e-6
const REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const TEXT_MAX_OUTPUT_TOKENS = 1024
const DECISION_MAX_OUTPUT_TOKENS = 256
const RULES_MAX_OUTPUT_TOKENS = 2048
const TEXT_MAX_LENGTH = 2000
const MIN_DECIMALS_FOR_ROUNDING_TOLERANCE = 2
const MAX_RETRIES = 0
const DECISION_HISTORY_LENGTH = 10
const TEXT_HISTORY_LENGTH = 6

const FIELD_VALUE_SCHEMA = jsonSchema({
  type: 'object',
  properties: { text: { type: ['string', 'null'] } },
  required: ['text'],
  additionalProperties: false
})

const roundingTolerance = (optionCount, rounding) => {
  const decimals = rounding?.probabilityDecimals
  return Number.isInteger(decimals) && decimals >= MIN_DECIMALS_FOR_ROUNDING_TOLERANCE
    ? (optionCount * 10 ** -decimals) / 2
    : 0
}

const isProbability = value => typeof value === 'number' && value >= 0 && value <= 1

const isWinningDistribution = (answer, ids, rounding) => {
  const probabilities = answer?.probabilities
  if (!probabilities || !ids.includes(answer.choice)) return false
  if (Object.keys(probabilities).length !== ids.length) return false
  if (!ids.every(id => Object.hasOwn(probabilities, id))) return false
  const values = Object.values(probabilities)
  if (!values.every(isProbability)) return false
  const sum = values.reduce((total, value) => total + value, 0)
  const sumTolerance = Math.max(PROBABILITY_SUM_TOLERANCE, roundingTolerance(ids.length, rounding))
  if (Math.abs(sum - 1) > sumTolerance) return false
  return probabilities[answer.choice] >= Math.max(...values) - WINNER_TOLERANCE
}

const invalidDecision = () => new TypeError('Invalid decisions response; no action executed.')

const validateChoice = (answer, ids, rounding, invalid = invalidDecision) => {
  if (!isWinningDistribution(answer, ids, rounding)) throw invalid()
  const { choice, probabilities } = answer
  return { choice, probabilities, confidence: probabilities[choice] }
}

const OPERATION_DESCRIPTIONS = {
  CLICK: 'Click an element, button, menu option, autocomplete suggestion, or calendar day.',
  TYPE_TEXT:
    'Enter or replace text in an editable field. A small LLM will supply the value from the goal.',
  SELECT: 'Select an observed dropdown value.',
  SUBMIT: 'Press Enter in a field that already holds the needed value, to submit it.'
}

const actionSpace = actions => {
  const elements = []
  const indices = new Map()
  const targets = {}
  const controls = {}
  const operations = { click: 'CLICK', fill: 'TYPE_TEXT', select: 'SELECT', submit: 'SUBMIT' }
  for (const action of actions) {
    const operation = operations[action.kind]
    if (!operation) {
      controls[action.id.toUpperCase()] = action
      continue
    }
    if (!indices.has(action.node)) {
      const index = String(elements.length + 1)
      indices.set(action.node, index)
      elements.push({
        index,
        label: action.label.split(' → ')[0],
        role: action.role,
        value: action.current_value ?? action.value,
        checked: action.checked,
        selected: action.selected,
        expanded: action.expanded,
        operations: [],
        options: []
      })
    }
    const index = indices.get(action.node)
    const element = elements[Number(index) - 1]
    if (!element.operations.includes(operation)) element.operations.push(operation)
    let target = index
    if (operation === 'SELECT') {
      target = `${index}:${element.options.length + 1}`
      element.options.push({ index: target, label: action.label, value: action.value })
    }
    ;(targets[operation] ||= {})[target] = action
  }
  return { elements, targets, controls }
}

const withoutUndefined = value => JSON.parse(JSON.stringify(value))

const pageOf = state => ({ url: state.url, title: state.title, text: state.text })

const recentActions = history =>
  history
    .slice(-DECISION_HISTORY_LENGTH)
    .map(({ operation, action, text, stale, pageChanged }) => ({
      operation,
      action,
      text,
      stale,
      page_changed: pageChanged
    }))

const buildRequest = (state, goal, history) => {
  const space = actionSpace(state.actions)
  const operations = Object.fromEntries(
    Object.keys(space.targets).map(key => [key, OPERATION_DESCRIPTIONS[key]])
  )
  for (const [key, value] of Object.entries(space.controls)) operations[key] = value.label
  Object.assign(operations, {
    DONE: 'Every requirement is visibly satisfied.',
    BLOCKED: 'No supported operation can progress.'
  })
  const questions = {
    operation: { type: 'choice', criteria: operations, instructions: { goal, rules: NEXT_ACTION } }
  }
  for (const [operation, candidates] of Object.entries(space.targets)) {
    questions[`${operation.toLowerCase()}_target`] = {
      type: 'choice',
      criteria: Object.fromEntries(
        Object.entries(candidates).map(([index, a]) => [
          index,
          {
            element: `[${index}] ${a.label}`,
            current_value: a.current_value ?? a.value ?? '',
            role: a.role,
            checked: a.checked,
            selected: a.selected,
            expanded: a.expanded
          }
        ])
      ),
      instructions: { goal, operation, rules: [NEXT_ACTION, TARGET] }
    }
  }
  return {
    space,
    operations,
    request: withoutUndefined({
      state: {
        page: pageOf(state),
        elements: space.elements,
        recent_actions: recentActions(history)
      },
      questions
    })
  }
}

const requestSignal = ({ signal, timeout }) =>
  signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)

const withinTimeout = async (options, call) => {
  const abortSignal = requestSignal(options)
  const result = await call(abortSignal)
  abortSignal.throwIfAborted()
  return result
}

const gatewayCost = providerMetadata => {
  const usd = Number.parseFloat(providerMetadata?.gateway?.cost)
  return Number.isFinite(usd) ? usd : undefined
}

const callMetrics = (kind, result, ms) => {
  const usage = result?.totalUsage ?? result?.usage ?? {}
  return {
    kind,
    ms,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    cachedInputTokens: usage.inputTokenDetails?.cacheReadTokens,
    cacheWriteTokens: usage.inputTokenDetails?.cacheWriteTokens,
    reasoningTokens: usage.outputTokenDetails?.reasoningTokens,
    usd: gatewayCost(result?.providerMetadata),
    generationId: result?.providerMetadata?.gateway?.generationId
  }
}

// ai 7.0.133 wraps a plain state as [{ type: 'json', value }] before doDecide.
// Hand the model the object this package built.
const plainDecisionState = state => {
  const part = Array.isArray(state) && state.length === 1 ? state[0] : undefined
  return part?.type === 'json' ? part.value : state
}

const withPlainDecisionState = model => {
  const provider = globalThis.AI_SDK_DEFAULT_PROVIDER ?? gateway
  const resolved =
    typeof model === 'string'
      ? (provider.decisionModel ?? provider.evaluationModel).call(provider, model)
      : model
  return Object.create(resolved, {
    doDecide: {
      value: options => resolved.doDecide({ ...options, state: plainDecisionState(options.state) })
    }
  })
}

const metered = async (options, kind, call) => {
  const started = performance.now()
  const result = await call()
  options.onCall?.(callMetrics(kind, result, Math.round(performance.now() - started)))
  return result
}

const decide = async (state, goal, history, model, options) => {
  const { space, operations, request } = buildRequest(state, goal, history)
  const { answers, rounding } = await withinTimeout(options, abortSignal =>
    metered(options, 'decision', () =>
      decideWithModel({
        model: withPlainDecisionState(model),
        ...request,
        maxRetries: MAX_RETRIES,
        abortSignal
      })
    )
  )
  const answer = validateChoice(answers?.operation, Object.keys(operations), rounding)
  const operation = answer.choice
  let targetAnswer
  let action = space.controls[operation]
  if (space.targets[operation]) {
    targetAnswer = validateChoice(
      answers?.[`${operation.toLowerCase()}_target`],
      Object.keys(space.targets[operation]),
      rounding
    )
    action = space.targets[operation][targetAnswer.choice]
  }
  return {
    operation,
    action,
    confidence: answer.confidence,
    probabilities: answer.probabilities,
    targetConfidence: targetAnswer?.confidence,
    targetProbabilities: targetAnswer?.probabilities
  }
}

const invalidFieldValue = () =>
  new TypeError('Text helper returned no valid field value; nothing typed.')

const generateObject = async (request, invalidOutput, options, kind) => {
  try {
    const { output } = await metered(options, kind, () => generateText(request))
    return output
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      throw invalidOutput(error)
    }
    throw error
  }
}

const languageDecisionSchema = operations =>
  jsonSchema({
    type: 'object',
    properties: {
      operation: { type: 'string', enum: operations },
      target: { type: ['string', 'null'] }
    },
    required: ['operation', 'target'],
    additionalProperties: false
  })

const askLanguageModel = (request, operationIds, model, options) =>
  withinTimeout(options, abortSignal =>
    generateObject(
      {
        model,
        system: LANGUAGE_DECISION,
        prompt: JSON.stringify(request),
        output: Output.object({ schema: languageDecisionSchema(operationIds) }),
        maxOutputTokens: DECISION_MAX_OUTPUT_TOKENS,
        maxRetries: MAX_RETRIES,
        reasoning: options.reasoning,
        abortSignal
      },
      invalidDecision,
      options,
      'decision'
    )
  )

const decideWithLanguageModel = async (state, goal, history, model, options) => {
  const { space, operations, request } = buildRequest(state, goal, history)
  const output = await askLanguageModel(request, Object.keys(operations), model, options)
  const operation = output?.operation
  if (typeof operation !== 'string' || !Object.hasOwn(operations, operation)) {
    throw invalidDecision()
  }
  const targets = space.targets[operation]
  if (!targets) return { operation, action: space.controls[operation] }
  if (typeof output.target !== 'string' || !Object.hasOwn(targets, output.target)) {
    throw invalidDecision()
  }
  return { operation, action: targets[output.target] }
}

const isFieldValue = output =>
  !!output &&
  typeof output === 'object' &&
  Object.keys(output).length === 1 &&
  typeof output.text === 'string' &&
  output.text.trim() !== '' &&
  output.text.length <= TEXT_MAX_LENGTH

const fieldText = async (goal, action, state, history, model, options) => {
  const output = await withinTimeout(options, abortSignal =>
    generateObject(
      {
        model,
        system: TEXT_VALUE,
        prompt: JSON.stringify({
          goal,
          field: {
            id: action.id,
            node: action.node,
            label: action.label,
            role: action.role,
            value: action.value,
            context: state.scopes?.[action.node] ?? ''
          },
          page: { title: state.title, text: state.text },
          recent_actions: history.slice(-TEXT_HISTORY_LENGTH)
        }),
        output: Output.object({ schema: FIELD_VALUE_SCHEMA }),
        maxOutputTokens: TEXT_MAX_OUTPUT_TOKENS,
        maxRetries: MAX_RETRIES,
        reasoning: options.reasoning,
        abortSignal
      },
      invalidFieldValue,
      options,
      'text'
    )
  )
  if (output?.text === null) {
    throw new BlockedError('model_blocked', 'The goal does not say what to type in this field.')
  }
  if (!isFieldValue(output)) throw invalidFieldValue()
  return output.text
}

const invalidRules = cause =>
  new TypeError('The model did not write usable extraction rules.', { cause })

const writeRules = (instruction, outline, fields, model, options) =>
  withinTimeout(options, abortSignal =>
    generateObject(
      {
        model,
        system: RULES_WRITER,
        prompt: JSON.stringify({ instruction, fields, page: outline }),
        output: Output.json(),
        maxOutputTokens: RULES_MAX_OUTPUT_TOKENS,
        maxRetries: MAX_RETRIES,
        reasoning: options.reasoning,
        abortSignal
      },
      invalidRules,
      options,
      'rules'
    )
  )

const GOAL_VERDICTS = {
  yes: 'Every requirement of the goal is visibly satisfied on the current page.',
  no: 'At least one requirement of the goal is not visibly satisfied on the current page.'
}

const FINAL_OPERATIONS = ['DONE', 'BLOCKED']

const actionsTaken = history => {
  let end = history.length
  while (end > 0 && FINAL_OPERATIONS.includes(history[end - 1].operation)) end--
  return history.slice(0, end)
}

const invalidEvaluation = () => new TypeError('Invalid evaluation response; no verdict given.')

const evaluationRequest = (state, goal, history) =>
  withoutUndefined({
    state: {
      page: pageOf(state),
      elements: actionSpace(state.actions).elements,
      recent_actions: recentActions(actionsTaken(history))
    },
    questions: {
      passed: {
        type: 'choice',
        criteria: GOAL_VERDICTS,
        instructions: { goal, rules: GOAL_EVALUATION }
      }
    }
  })

const evaluateGoal = async (request, model, options) => {
  const { answers, rounding } = await withinTimeout(options, abortSignal =>
    metered(options, 'evaluation', () =>
      decideWithModel({
        model: withPlainDecisionState(model),
        ...request,
        maxRetries: MAX_RETRIES,
        abortSignal
      })
    )
  )
  const { choice, probabilities } = validateChoice(
    answers?.passed,
    Object.keys(GOAL_VERDICTS),
    rounding,
    invalidEvaluation
  )
  return { passed: choice === 'yes', probability: probabilities.yes }
}

module.exports = {
  REASONING_LEVELS,
  withPlainDecisionState,
  evaluateGoal,
  evaluationRequest,
  writeRules,
  invalidRules,
  validateChoice,
  actionSpace,
  buildRequest,
  decide,
  decideWithLanguageModel,
  askLanguageModel,
  fieldText
}

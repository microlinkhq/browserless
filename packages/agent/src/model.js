'use strict'

const {
  experimental_decide: decideWithModel,
  generateText,
  Output,
  jsonSchema,
  NoObjectGeneratedError,
  NoOutputGeneratedError
} = require('ai')

const { NEXT_ACTION, TARGET, TEXT_VALUE } = require('./questions')

const PROBABILITY_SUM_TOLERANCE = 0.02
const WINNER_TOLERANCE = 1e-6
const TEXT_MAX_OUTPUT_TOKENS = 1024
const TEXT_MAX_LENGTH = 2000
const MIN_DECIMALS_FOR_ROUNDING_TOLERANCE = 2
const MAX_RETRIES = 0
const DECISION_HISTORY_LENGTH = 10
const TEXT_HISTORY_LENGTH = 6

const FIELD_VALUE_SCHEMA = jsonSchema({
  type: 'object',
  properties: { text: { type: 'string' } },
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

const validateChoice = (answer, ids, rounding) => {
  if (!isWinningDistribution(answer, ids, rounding)) {
    throw new TypeError('Invalid decisions response; no action executed.')
  }
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
        page: { url: state.url, title: state.title, text: state.text },
        elements: space.elements,
        recent_actions: history
          .slice(-DECISION_HISTORY_LENGTH)
          .map(({ operation, action, text, stale, pageChanged }) => ({
            operation,
            action,
            text,
            stale,
            page_changed: pageChanged
          }))
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

const decide = async (state, goal, history, model, options) => {
  const { space, operations, request } = buildRequest(state, goal, history)
  const { answers, rounding } = await withinTimeout(options, abortSignal =>
    decideWithModel({ model, ...request, maxRetries: MAX_RETRIES, abortSignal })
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

const generateFieldValue = async request => {
  try {
    const { output } = await generateText(request)
    return output
  } catch (error) {
    if (NoObjectGeneratedError.isInstance(error) || NoOutputGeneratedError.isInstance(error)) {
      throw invalidFieldValue()
    }
    throw error
  }
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
    generateFieldValue({
      model,
      system: TEXT_VALUE,
      prompt: JSON.stringify({
        goal,
        field: { label: action.label, role: action.role, value: action.value },
        page: { title: state.title, text: state.text },
        recent_actions: history.slice(-TEXT_HISTORY_LENGTH)
      }),
      output: Output.object({ schema: FIELD_VALUE_SCHEMA }),
      maxOutputTokens: TEXT_MAX_OUTPUT_TOKENS,
      maxRetries: MAX_RETRIES,
      reasoning: options.reasoning,
      abortSignal
    })
  )
  if (!isFieldValue(output)) throw invalidFieldValue()
  return output.text
}

module.exports = { validateChoice, actionSpace, buildRequest, decide, fieldText }

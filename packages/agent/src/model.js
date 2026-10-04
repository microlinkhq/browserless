'use strict'

const { NEXT_ACTION, TARGET, TEXT_VALUE } = require('./questions')

const validateChoice = (answer, ids) => {
  const probabilities = answer?.probabilities
  const keys = probabilities && Object.keys(probabilities)
  const finite = n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1
  if (
    !ids.includes(answer?.choice) ||
    !keys ||
    keys.length !== ids.length ||
    !ids.every(id => Object.hasOwn(probabilities, id)) ||
    !Object.values(probabilities).every(finite) ||
    !finite(answer.confidence) ||
    Math.abs(Object.values(probabilities).reduce((a, b) => a + b, 0) - 1) >= 0.02 ||
    probabilities[answer.choice] < Math.max(...Object.values(probabilities)) - 1e-6
  ) {
    throw new TypeError('Invalid decisions response; no action executed.')
  }
  return answer
}

const actionSpace = actions => {
  const elements = []
  const indices = new Map()
  const targets = {}
  const controls = {}
  const operations = { click: 'CLICK', fill: 'TYPE_TEXT', select: 'SELECT' }
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

const buildRequest = (state, goal, history, model) => {
  const space = actionSpace(state.actions)
  const operations = Object.fromEntries(Object.keys(space.targets).map(key => [key, key]))
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
    body: {
      model,
      state: {
        page: { url: state.url, title: state.title, text: state.text },
        elements: space.elements,
        recent_actions: history
          .slice(-10)
          .map(({ operation, action, text, pageChanged }) => ({
            operation,
            action,
            text,
            page_changed: pageChanged
          }))
      },
      questions
    }
  }
}

const provider = (input, defaults = {}) => {
  const config = { ...defaults, ...input }
  for (const key of ['apiKey', 'baseUrl', 'model']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) { throw new TypeError(`Provider requires ${key}.`) }
  }
  const url = new URL(config.baseUrl)
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) { throw new TypeError('Provider baseUrl must be a clean HTTPS URL.') }
  return { ...config, baseUrl: config.baseUrl.replace(/\/$/, '') }
}

const post = async (config, path, body, options) => {
  const response = await options.fetch(`${config.baseUrl}/${path}`, {
    method: 'POST',
    redirect: 'error',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: options.signal
      ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeout)])
      : AbortSignal.timeout(options.timeout)
  })
  if (!response.ok) { throw new Error(`Model provider returned HTTP ${response.status}; no action executed.`) }
  return response.json()
}

const decide = async (state, goal, history, config, options) => {
  const { space, operations, body } = buildRequest(state, goal, history, config.model)
  const result = await post(config, 'systemone', body, options)
  const answer = validateChoice(result?.answers?.operation, Object.keys(operations))
  const operation = answer.choice
  let targetAnswer
  let action = space.controls[operation]
  if (space.targets[operation]) {
    targetAnswer = validateChoice(
      result?.answers?.[`${operation.toLowerCase()}_target`],
      Object.keys(space.targets[operation])
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

const fieldText = async (goal, action, state, history, config, options) => {
  const result = await post(
    config,
    'chat/completions',
    {
      model: config.model,
      max_tokens: 1024,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: TEXT_VALUE },
        {
          role: 'user',
          content: JSON.stringify({
            goal,
            field: { label: action.label, role: action.role, value: action.value },
            page: { title: state.title, text: state.text },
            recent_actions: history.slice(-6)
          })
        }
      ]
    },
    options
  )
  let output
  try {
    output = JSON.parse(result.choices[0].message.content)
  } catch {}
  if (
    !output ||
    Object.keys(output).length !== 1 ||
    typeof output.text !== 'string' ||
    !output.text.trim() ||
    output.text.length > 2000
  ) { throw new TypeError('Text helper returned no valid field value; nothing typed.') }
  return output.text
}

module.exports = { validateChoice, actionSpace, buildRequest, provider, decide, fieldText }

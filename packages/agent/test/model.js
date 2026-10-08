'use strict'

const test = require('ava')
const {
  validateChoice,
  actionSpace,
  buildRequest,
  decide,
  decideWithLanguageModel,
  fieldText
} = require('../src/model')
const { BlockedError } = require('../src/errors')
const { APICallError } = require('ai')
const { state, answer, decisionModel, textModel, mockModels } = require('./fixtures/page')

const retryableFailure = () =>
  new APICallError({
    message: 'provider unavailable',
    url: 'https://fixture.invalid',
    requestBodyValues: {},
    statusCode: 503,
    isRetryable: true
  })

const afterMs = (ms, value) => new Promise(resolve => setTimeout(() => resolve(value), ms))

const mockAnswers = () => ({
  operation: answer('CLICK', OPERATIONS),
  click_target: answer('1', ['1']),
  type_text_target: answer('1', ['1'])
})

const REQUEST = { timeout: 1000, reasoning: 'none' }
const OPERATIONS = ['TYPE_TEXT', 'CLICK', 'WAIT', 'DONE', 'BLOCKED']

test('strict choice contract accepts a normalized winning member', t => {
  t.deepEqual(validateChoice(answer('a', ['a', 'b']), ['a', 'b']), {
    choice: 'a',
    probabilities: { a: 1, b: 0 },
    confidence: 1
  })
})

test('confidence is the probability of the chosen member', t => {
  const uncertain = { choice: 'a', probabilities: { a: 0.6, b: 0.4 } }
  t.is(validateChoice(uncertain, ['a', 'b']).confidence, 0.6)
})

for (const [name, bad] of Object.entries({
  missing: {},
  unknown: answer('c', ['a', 'b']),
  noProbabilities: { choice: 'a' },
  missingProbability: { choice: 'a', probabilities: { a: 1 } },
  extraProbability: { choice: 'a', probabilities: { a: 1, b: 0, c: 0 } },
  nonFinite: { choice: 'a', probabilities: { a: Infinity, b: 0 } },
  negative: { choice: 'a', probabilities: { a: 1.1, b: -0.1 } },
  sum: { choice: 'a', probabilities: { a: 0.8, b: 0.1 } },
  notWinner: { choice: 'a', probabilities: { a: 0.2, b: 0.8 } }
})) {
  test(`contract fails closed: ${name}`, t =>
    t.throws(() => validateChoice(bad, ['a', 'b']), { instanceOf: TypeError }))
}

test('probability sum tolerance grows with the rounding the provider reports', t => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']
  const rounded = {
    choice: 'a',
    probabilities: Object.fromEntries(ids.map(id => [id, id === 'a' ? 0.5 : 0.05]))
  }
  rounded.probabilities.b = 0.14
  t.throws(() => validateChoice(rounded, ids), { instanceOf: TypeError })
  t.is(validateChoice(rounded, ids, { probabilityDecimals: 2 }).choice, 'a')
  t.throws(() => validateChoice(rounded, ids, { probabilityDecimals: 3 }), {
    instanceOf: TypeError
  })
})

test('three ID layers: one model index for two actions on one DOM node', t => {
  const space = actionSpace(state().actions)
  t.is(space.elements.length, 1)
  t.is(space.targets.TYPE_TEXT['1'].id, 'e1')
  t.is(space.targets.CLICK['1'].id, 'e2')
})

test('select options have distinct indices for the same retained node', t => {
  const space = actionSpace(
    ['cheap', 'recent'].map((value, i) => ({
      id: `e${i + 1}`,
      node: 7,
      kind: 'select',
      label: `Sort → ${value}`,
      value
    }))
  )
  t.deepEqual(Object.keys(space.targets.SELECT), ['1:1', '1:2'])
  t.is(space.targets.SELECT['1:2'].value, 'recent')
  t.is(space.elements[0].label, 'Sort')
})

test('a literal arrow in a control label is kept', t => {
  const space = actionSpace([
    { id: 'e1', node: 1, kind: 'click', role: 'button', label: 'Move → Inbox', value: '' },
    { id: 'e2', node: 2, kind: 'click', role: 'button', label: 'Move → Archive', value: '' }
  ])
  t.deepEqual(
    space.elements.map(element => element.label),
    ['Move → Inbox', 'Move → Archive']
  )
})

test('one speculative request consumes only the operation-selected head', async t => {
  const calls = []
  const model = decisionModel(async ({ questions }) => {
    calls.push(questions)
    return {
      answers: {
        operation: answer('CLICK', OPERATIONS),
        click_target: answer('1', ['1']),
        type_text_target: { type: 'choice', choice: '1' }
      },
      warnings: []
    }
  })
  const result = await decide(state(), 'find cars', [], model, REQUEST)
  t.is(result.action.id, 'e2')
  t.is(calls.length, 1)
  t.truthy(calls[0].type_text_target)
  t.truthy(calls[0].click_target)
})

test('selected malformed head blocks rather than running a different head', async t => {
  const model = decisionModel(async () => ({
    answers: {
      operation: answer('CLICK', OPERATIONS),
      click_target: { type: 'choice', choice: '1' },
      type_text_target: answer('1', ['1'])
    },
    warnings: []
  }))
  await t.throwsAsync(decide(state(), 'cars', [], model, REQUEST), {
    message: 'Invalid decisions response; no action executed.'
  })
})

test('a choice outside the offered targets is rejected', async t => {
  const model = decisionModel(async () => ({
    answers: {
      operation: answer('CLICK', OPERATIONS),
      click_target: answer('99', ['99']),
      type_text_target: answer('1', ['1'])
    },
    warnings: []
  }))
  await t.throwsAsync(decide(state(), 'cars', [], model, REQUEST))
})

test('a decision carries confidences derived from the winning probabilities', async t => {
  const model = decisionModel(async () => ({
    answers: {
      operation: {
        type: 'choice',
        choice: 'CLICK',
        probabilities: { TYPE_TEXT: 0.2, CLICK: 0.7, WAIT: 0.1, DONE: 0, BLOCKED: 0 }
      },
      click_target: answer('1', ['1']),
      type_text_target: answer('1', ['1'])
    },
    rounding: { probabilityDecimals: 2 },
    warnings: []
  }))
  const decision = await decide(state(), 'cars', [], model, REQUEST)
  t.is(decision.confidence, 0.7)
  t.is(decision.targetConfidence, 1)
})

test('a failing decision model is not retried and never produces a decision', async t => {
  let calls = 0
  const model = decisionModel(async () => {
    calls++
    throw retryableFailure()
  })
  await t.throwsAsync(decide(state(), 'cars', [], model, REQUEST), {
    message: /provider unavailable/
  })
  t.is(calls, 1)
})

test('a decision request that outlives the timeout is aborted', async t => {
  const model = decisionModel(
    ({ abortSignal }) =>
      new Promise((resolve, reject) =>
        abortSignal.addEventListener('abort', () => reject(abortSignal.reason))
      )
  )
  await t.throwsAsync(decide(state(), 'cars', [], model, { timeout: 20 }), {
    name: 'TimeoutError'
  })
})

test('a missing field value stops as model_blocked', async t => {
  const error = await t.throwsAsync(
    fieldText('cars', state().actions[0], state(), [], textModel('{"text":null}'), REQUEST),
    { instanceOf: BlockedError }
  )
  t.is(error.reason, 'model_blocked')
})

for (const content of [
  '{}',
  '{"text":" "}',
  '{"text":"x","code":"click()"}',
  '["x"]',
  'not json',
  JSON.stringify({ text: 'x'.repeat(2001) })
]) {
  test(`text model output is rejected: ${content.slice(0, 35)}`, async t => {
    await t.throwsAsync(
      fieldText('cars', state().actions[0], state(), [], textModel(content), REQUEST),
      { message: 'Text helper returned no valid field value; nothing typed.' }
    )
  })
}

test('an empty text value clears the field', async t => {
  t.is(
    await fieldText('cars', state().actions[0], state(), [], textModel('{"text":""}'), REQUEST),
    ''
  )
})

test('text model returns only a validated field value', async t => {
  t.is(
    await fieldText(
      'cars',
      state().actions[0],
      state(),
      [],
      textModel('{"text":"bmw x3"}'),
      REQUEST
    ),
    'bmw x3'
  )
})

test('text model receives the goal, field, reasoning level and a single attempt', async t => {
  const models = mockModels([])
  await fieldText('cars', state().actions[0], state(), [], models.text, {
    timeout: 1000,
    reasoning: 'low'
  })
  const [{ options }] = models.calls
  t.is(options.reasoning, 'low')
  t.is(options.maxOutputTokens, 1024)
  t.is(options.responseFormat.type, 'json')
  const user = options.prompt.find(message => message.role === 'user')
  const context = JSON.parse(user.content[0].text)
  t.is(context.goal, 'cars')
  t.deepEqual(context.field, {
    id: 'e1',
    node: 1,
    label: 'Search',
    role: 'searchbox',
    value: '',
    context: ''
  })
  t.is(models.calls.length, 1)
})

test('same-labeled fields are distinct in the text-helper prompt', async t => {
  const page = state()
  page.scopes = { 10: 'Passenger 1\nFirst name', 20: 'Passenger 2\nFirst name' }
  const first = {
    id: 'e1',
    node: 10,
    role: 'textbox',
    label: 'First name',
    kind: 'fill',
    value: ''
  }
  const second = { ...first, id: 'e2', node: 20 }
  const promptFor = async action => {
    const models = mockModels([])
    await fieldText('book two passengers', action, page, [], models.text, REQUEST)
    const user = models.calls[0].options.prompt.find(message => message.role === 'user')
    return JSON.parse(user.content[0].text).field
  }
  const [left, right] = await Promise.all([promptFor(first), promptFor(second)])
  t.notDeepEqual(left, right)
  t.is(left.context, 'Passenger 1\nFirst name')
  t.is(right.id, 'e2')
  t.is(right.node, 20)
})

test('a failing text model is not retried', async t => {
  const models = mockModels([], {
    onText: () => {
      throw retryableFailure()
    }
  })
  await t.throwsAsync(fieldText('cars', state().actions[0], state(), [], models.text, REQUEST), {
    message: /provider unavailable/
  })
  t.is(models.calls.length, 1)
})

test('recent actions tell the model which decisions were discarded as stale', t => {
  const history = [
    { operation: 'TYPE_TEXT', action: 'e1', text: 'bmw x3', stale: true },
    { operation: 'CLICK', action: 'e2', pageChanged: true }
  ]
  t.deepEqual(buildRequest(state(), 'cars', history).request.state.recent_actions, [
    { operation: 'TYPE_TEXT', action: 'e1', text: 'bmw x3', stale: true },
    { operation: 'CLICK', action: 'e2', page_changed: true }
  ])
})

test('SUBMIT is offered with its own target question and a description', t => {
  const populated = state()
  populated.actions.push({
    id: 'e3',
    node: 1,
    role: 'searchbox',
    label: 'Submit Search',
    kind: 'submit',
    value: 'bmw x3'
  })
  const { request, space } = buildRequest(populated, 'cars', [])
  t.regex(request.questions.operation.criteria.SUBMIT, /Press Enter/)
  t.regex(request.questions.operation.criteria.CLICK, /Click an element/)
  t.deepEqual(Object.keys(request.questions.submit_target.criteria), ['1'])
  t.is(space.targets.SUBMIT['1'].id, 'e3')
  t.deepEqual(request.state.elements[0].operations, ['TYPE_TEXT', 'CLICK', 'SUBMIT'])
})

test('rounding only widens the tolerance when it is an integer of two or more decimals', t => {
  const ids = ['a', 'b', 'c']
  const inflated = { choice: 'a', probabilities: { a: 0.6, b: 0.3, c: 0.3 } }
  for (const probabilityDecimals of [0, 1, -1, NaN, null, 1.5, -Infinity]) {
    t.throws(() => validateChoice(inflated, ids, { probabilityDecimals }), {
      instanceOf: TypeError
    })
  }
})

test('a decision that arrives after the timeout is discarded', async t => {
  const model = decisionModel(() => afterMs(60, { answers: mockAnswers(), warnings: [] }))
  await t.throwsAsync(decide(state(), 'cars', [], model, { timeout: 20 }), {
    name: 'TimeoutError'
  })
})

test('a text value that arrives after the timeout is discarded', async t => {
  const models = mockModels([])
  const generate = models.text.doGenerate
  models.text.doGenerate = async options => afterMs(60, await generate(options))
  await t.throwsAsync(
    fieldText('cars', state().actions[0], state(), [], models.text, { timeout: 20 }),
    { name: 'TimeoutError' }
  )
})

test('the caller signal reaches both models and aborts them', async t => {
  const controller = new AbortController()
  controller.abort()
  const request = { timeout: 1000, signal: controller.signal }
  const models = mockModels(['CLICK'])
  await t.throwsAsync(decide(state(), 'cars', [], models.decisions, request), {
    name: 'AbortError'
  })
  await t.throwsAsync(fieldText('cars', state().actions[0], state(), [], models.text, request), {
    name: 'AbortError'
  })
})

test('a text reply without output is rejected as an invalid field value', async t => {
  const model = textModel('{"text":"bmw x3"}')
  const generate = model.doGenerate
  model.doGenerate = async options => ({
    ...(await generate(options)),
    content: [],
    finishReason: { unified: 'tool-calls', raw: 'tool_calls' }
  })
  await t.throwsAsync(fieldText('cars', state().actions[0], state(), [], model, REQUEST), {
    message: 'Text helper returned no valid field value; nothing typed.'
  })
})

test('a failing language model decision is not retried', async t => {
  const model = textModel('{}')
  let calls = 0
  model.doGenerate = async () => {
    calls++
    throw retryableFailure()
  }
  await t.throwsAsync(decideWithLanguageModel(state(), 'cars', [], model, REQUEST), {
    message: /provider unavailable/
  })
  t.is(calls, 1)
})

test('a language model decision that arrives after the timeout is discarded', async t => {
  const model = textModel('{"operation":"DONE","target":null}')
  const generate = model.doGenerate
  model.doGenerate = async options => afterMs(60, await generate(options))
  await t.throwsAsync(decideWithLanguageModel(state(), 'cars', [], model, { timeout: 20 }), {
    name: 'TimeoutError'
  })
})

test('a language model decision without a target runs the page-level control', async t => {
  const model = textModel('{"operation":"WAIT","target":null}')
  const decision = await decideWithLanguageModel(state(), 'cars', [], model, REQUEST)
  t.is(decision.operation, 'WAIT')
  t.is(decision.action.id, 'wait')
})

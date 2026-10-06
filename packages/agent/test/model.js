'use strict'

const test = require('ava')
const {
  validateChoice,
  actionSpace,
  buildRequest,
  decide,
  fieldText,
  provider: validateProvider
} = require('../src/model')
const { state, answer, mockFetch, provider } = require('./fixtures/page')
const http = fetch => ({ fetch, timeout: 1000 })

test('strict choice contract accepts a normalized winning member', t => {
  t.is(validateChoice(answer('a', ['a', 'b']), ['a', 'b']).choice, 'a')
})

for (const [name, bad] of Object.entries({
  missing: {},
  unknown: answer('c', ['a', 'b']),
  missingProbability: { choice: 'a', confidence: 1, probabilities: { a: 1 } },
  extraProbability: { choice: 'a', confidence: 1, probabilities: { a: 1, b: 0, c: 0 } },
  nonFinite: { choice: 'a', confidence: 1, probabilities: { a: Infinity, b: 0 } },
  negative: { choice: 'a', confidence: 1, probabilities: { a: 1.1, b: -0.1 } },
  boolean: { choice: 'a', confidence: true, probabilities: { a: 1, b: 0 } },
  sum: { choice: 'a', confidence: 0.8, probabilities: { a: 0.8, b: 0.1 } },
  notWinner: { choice: 'a', confidence: 0.2, probabilities: { a: 0.2, b: 0.8 } }
})) {
  test(`contract fails closed: ${name}`, t =>
    t.throws(() => validateChoice(bad, ['a', 'b']), { instanceOf: TypeError }))
}

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
})

test('one speculative request consumes only the operation-selected head', async t => {
  const fetch = mockFetch(['CLICK'])
  const original = fetch
  const corruptUnused = async (...args) => {
    const response = await original(...args)
    const result = await response.json()
    result.answers.type_text_target = { choice: 'selector:body', confidence: NaN }
    return { ok: true, json: async () => result }
  }
  const result = await decide(state(), 'find cars', [], provider, http(corruptUnused))
  t.is(result.action.id, 'e2')
  t.is(fetch.calls.length, 1)
  t.truthy(fetch.calls[0].body.questions.type_text_target)
  t.truthy(fetch.calls[0].body.questions.click_target)
})

test('selected malformed head blocks rather than running a different head', async t => {
  const fetch = async () => ({
    ok: true,
    json: async () => ({
      answers: {
        operation: answer('CLICK', ['TYPE_TEXT', 'CLICK', 'WAIT', 'DONE', 'BLOCKED']),
        click_target: answer('99', ['99'])
      }
    })
  })
  await t.throwsAsync(decide(state(), 'cars', [], provider, http(fetch)), { instanceOf: TypeError })
})

for (const content of [
  '{}',
  '{"text":null}',
  '{"text":""}',
  '{"text":"x","code":"click()"}',
  'not json',
  JSON.stringify({ text: 'x'.repeat(2001) })
]) {
  test(`text helper rejects ${content.slice(0, 35)}`, async t => {
    await t.throwsAsync(
      fieldText(
        'cars',
        state().actions[0],
        state(),
        [],
        provider,
        http(mockFetch([], { text: content }))
      ),
      { instanceOf: TypeError }
    )
  })
}

test('text helper returns only a validated field value', async t => {
  t.is(
    await fieldText('cars', state().actions[0], state(), [], provider, http(mockFetch([]))),
    'bmw x3'
  )
})

for (const [setting, expected] of [
  [undefined, { enabled: false }],
  ['none', { enabled: false }],
  ['low', { effort: 'low' }],
  ['default', undefined]
]) {
  test(`text helper reasoning setting ${setting} is sent to the provider`, async t => {
    const fetch = mockFetch([])
    await fieldText(
      'cars',
      state().actions[0],
      state(),
      [],
      { ...provider, reasoning: setting },
      http(fetch)
    )
    t.deepEqual(fetch.calls[0].body.reasoning, expected)
  })
}

test('unknown text helper reasoning setting is rejected before any request', async t => {
  const fetch = mockFetch([])
  await t.throwsAsync(
    fieldText(
      'cars',
      state().actions[0],
      state(),
      [],
      { ...provider, reasoning: 'high' },
      http(fetch)
    ),
    { message: /reasoning must be one of: none, low, default/ }
  )
  t.is(fetch.calls.length, 0)
})

test('provider configuration must be explicit and secure', t => {
  for (const config of [
    {},
    { apiKey: 'x' },
    { ...provider, baseUrl: 'http://fixture.invalid' },
    { ...provider, baseUrl: 'https://user:pass@fixture.invalid' }
  ]) {
    t.throws(() => validateProvider(config), { instanceOf: TypeError })
  }
  t.deepEqual(validateProvider(provider), provider)
})

test('HTTP failure never produces a decision', async t => {
  await t.throwsAsync(
    decide(
      state(),
      'cars',
      [],
      provider,
      http(async () => ({ ok: false, status: 503 }))
    ),
    { message: /HTTP 503/ }
  )
})

test('HTTP failure releases the response body', async t => {
  let cancelled = 0
  const bodies = [
    {
      cancel: async () => {
        cancelled++
        throw new Error('already closed')
      }
    },
    {
      cancel: () => {
        cancelled++
        throw new Error('locked')
      }
    },
    { pipe: () => {} }
  ]
  for (const body of bodies) {
    await t.throwsAsync(
      decide(
        state(),
        'cars',
        [],
        provider,
        http(async () => ({ ok: false, status: 503, body }))
      ),
      { message: /HTTP 503/ }
    )
  }
  t.is(cancelled, 2)
})

test('recent actions tell the model which decisions were discarded as stale', t => {
  const history = [
    { operation: 'TYPE_TEXT', action: 'e1', text: 'bmw x3', stale: true },
    { operation: 'CLICK', action: 'e2', pageChanged: true }
  ]
  t.deepEqual(buildRequest(state(), 'cars', history, 'fixture').body.state.recent_actions, [
    { operation: 'TYPE_TEXT', action: 'e1', text: 'bmw x3', stale: true, page_changed: undefined },
    { operation: 'CLICK', action: 'e2', text: undefined, stale: undefined, page_changed: true }
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
  const { body, space } = buildRequest(populated, 'cars', [], 'fixture')
  t.regex(body.questions.operation.criteria.SUBMIT, /Press Enter/)
  t.regex(body.questions.operation.criteria.CLICK, /Click an element/)
  t.deepEqual(Object.keys(body.questions.submit_target.criteria), ['1'])
  t.is(space.targets.SUBMIT['1'].id, 'e3')
  t.deepEqual(body.state.elements[0].operations, ['TYPE_TEXT', 'CLICK', 'SUBMIT'])
})

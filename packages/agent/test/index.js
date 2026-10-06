'use strict'

const test = require('ava')
const agent = require('..')
const { execute } = require('../src/browser')
const {
  Page,
  state,
  mockModels,
  languageDecider,
  RULES,
  DATA,
  PAGE_OUTLINE
} = require('./fixtures/page')
const run = (page, operations, { models = mockModels(operations), ...options } = {}) =>
  agent.goal(page, 'find cheapest bmw x3', {
    decisions: models.decisions,
    text: models.text,
    waitMs: 0,
    ...options
  })

test('DONE returns trace and does not touch the page', async t => {
  const page = new Page()
  const result = await run(page, ['DONE'])
  t.is(result.status, 'done')
  t.is(result.steps, 0)
  t.is(result.decisions, 1)
  t.is(result.trace[0].confidence, 1)
  t.deepEqual(page.inputs, [])
  t.is(page.listenerCount('popup'), 0)
})

test('click then done uses a retained handle and disposes it', async t => {
  const page = new Page([state(), state('Results')])
  const result = await run(page, ['CLICK', 'DONE'])
  t.is(result.steps, 1)
  t.deepEqual(page.inputs, [{ click: true }])
  t.is(page.disposals, 1)
})

test('TYPE_TEXT alone invokes the text model, replaces text, revalidates focus', async t => {
  const page = new Page([state(), state('bmw x3')])
  const models = mockModels(['TYPE_TEXT', 'DONE'])
  await run(page, [], { models })
  t.deepEqual(page.inputs, [{ selectContents: true }, { text: 'bmw x3' }])
  t.deepEqual(
    models.calls.map(call => call.kind),
    ['decide', 'text', 'decide']
  )
})

for (const [reasoning, expected] of [
  [undefined, 'none'],
  ['low', 'low']
]) {
  test(`text model is called with reasoning ${expected} when the option is ${reasoning}`, async t => {
    const page = new Page([state(), state('bmw x3')])
    const models = mockModels(['TYPE_TEXT', 'DONE'])
    await run(page, [], { models, reasoning })
    t.is(models.calls.find(call => call.kind === 'text').options.reasoning, expected)
  })
}

test('a failing decision model is called once and no input is sent', async t => {
  const page = new Page()
  const models = mockModels([], {
    onDecide: () => {
      throw new Error('provider unavailable')
    }
  })
  await t.throwsAsync(run(page, [], { models }))
  t.is(models.calls.length, 1)
  t.deepEqual(page.inputs, [])
})

test('invalid generated text does not focus or type', async t => {
  const page = new Page()
  await t.throwsAsync(
    run(page, [], { models: mockModels(['TYPE_TEXT'], { text: '{"text":null}' }) }),
    { instanceOf: TypeError }
  )
  t.deepEqual(page.inputs, [])
})

test('stale click is discarded, then a new observation and decision are consumed', async t => {
  const page = new Page([state(), state('Changed')])
  page.guards = [false, true]
  const result = await run(page, ['CLICK', 'CLICK', 'DONE'])
  t.true(result.trace[0].stale)
  t.is(result.steps, 1)
  t.is(result.decisions, 3)
  t.deepEqual(page.inputs, [{ click: true }])
})

test('form changes while text helper runs cause no input', async t => {
  const page = new Page()
  const models = mockModels(['TYPE_TEXT', 'DONE'], {
    onText: () => {
      page.guards = [false]
    }
  })
  const result = await run(page, [], { models })
  t.true(result.trace[0].stale)
  t.deepEqual(page.inputs, [])
})

test('focus-driven context changes prevent typing', async t => {
  const page = new Page()
  page.guards = [true, false]
  const result = await run(page, ['TYPE_TEXT', 'DONE'])
  t.true(result.trace[0].stale)
  t.deepEqual(page.inputs, [])
})

test('model BLOCKED is a typed error carrying confidences', async t => {
  const error = await t.throwsAsync(run(new Page(), ['BLOCKED']), {
    instanceOf: agent.BlockedError
  })
  t.is(error.code, 'BLOCKED')
  t.is(error.reason, 'model_blocked')
  t.is(error.trace[0].confidence, 1)
})

test('action budget does not allow an extra action', async t => {
  const page = new Page([state(), state('Updated')])
  const error = await t.throwsAsync(run(page, ['CLICK', 'CLICK'], { maxSteps: 1 }), {
    instanceOf: agent.BlockedError
  })
  t.is(error.reason, 'step_budget')
  t.is(page.inputs.length, 1)
})

test('repeated stale decisions exhaust request budget without input', async t => {
  const page = new Page()
  page.guards = [false, false]
  const error = await t.throwsAsync(run(page, ['CLICK', 'CLICK'], { maxDecisions: 2 }), {
    instanceOf: agent.BlockedError
  })
  t.is(error.reason, 'step_budget')
  t.deepEqual(page.inputs, [])
})

test('three consecutive stale decisions on one target stop the run', async t => {
  const page = new Page()
  page.guards = [false, false, false]
  const models = mockModels(['CLICK', 'CLICK', 'CLICK', 'CLICK'])
  const error = await t.throwsAsync(run(page, [], { models }), { instanceOf: agent.BlockedError })
  t.is(error.reason, 'stale_target')
  t.is(error.trace.length, 3)
  t.is(models.calls.length, 3)
  t.deepEqual(page.inputs, [])
})

test('a successful action between stale decisions resets the stale count', async t => {
  const page = new Page([state(), state(), state(), state('Results')])
  page.guards = [false, false, false]
  const result = await run(page, ['CLICK', 'WAIT', 'CLICK', 'CLICK', 'DONE'])
  t.is(result.status, 'done')
  t.is(result.trace.filter(entry => entry.stale).length, 3)
})

test('three consecutive no-change actions block a fourth', async t => {
  const page = new Page()
  const error = await t.throwsAsync(run(page, ['WAIT', 'WAIT', 'WAIT', 'WAIT']), {
    instanceOf: agent.BlockedError
  })
  t.is(error.reason, 'no_change')
  t.is(error.trace.filter(entry => entry.pageChanged === false).length, 3)
})

test('an action that changed nothing is not offered again until the page changes', async t => {
  const page = new Page([state(), state(), state('Changed')])
  const models = mockModels(['CLICK', 'TYPE_TEXT', 'DONE'])
  await run(page, [], { models })
  const decisionRequests = models.calls.filter(call => call.kind === 'decide')
  t.deepEqual(
    decisionRequests.map(call => 'click_target' in call.questions),
    [true, false, true]
  )
  t.false('CLICK' in decisionRequests[1].questions.operation.criteria)
})

for (const [reason, changes] of [
  ['captcha', { text: 'Verify you are human' }],
  ['login_wall', { unsupported: ['password'] }],
  ['unsupported_surface', { unsupported: ['iframe'] }]
]) {
  test(`pre-observation blocks ${reason} without a model call`, async t => {
    const page = new Page([{ ...state(), ...changes }])
    const models = mockModels([])
    const error = await t.throwsAsync(run(page, [], { models }), { instanceOf: agent.BlockedError })
    t.is(error.reason, reason)
    t.is(models.calls.length, 0)
  })
}

test('popup is blocked and never followed', async t => {
  const page = new Page([state(), state('Updated')])
  const click = page.evaluateHandle.bind(page)
  page.evaluateHandle = async () => {
    const handle = await click()
    handle.asElement().click = async () => page.emit('popup', {})
    return handle
  }
  const error = await t.throwsAsync(run(page, ['CLICK']), { instanceOf: agent.BlockedError })
  t.is(error.reason, 'unsupported_surface')
  t.is(page.listenerCount('popup'), 0)
})

test('scroll freshness requires the observed marker', async t => {
  const page = new Page([state('changed')])
  await t.throwsAsync(execute(page, state(), { kind: 'scroll', delta: 560 }, undefined, 0), {
    name: 'StaleDecisionError'
  })
  t.deepEqual(page.inputs, [])
})

test('select uses Puppeteer select with observed value', async t => {
  const page = new Page()
  await execute(page, state(), { kind: 'select', node: 1, value: 'cheap' }, undefined, 0)
  t.deepEqual(page.inputs, [{ select: 'cheap' }])
})

test('WAIT on a page that keeps changing waits and is never stale', async t => {
  const page = new Page([state('Loading 1'), state('Loading 2'), state('Results')])
  const result = await run(page, ['WAIT', 'WAIT', 'DONE'])
  t.is(result.status, 'done')
  t.is(result.steps, 2)
  t.deepEqual(
    result.trace.map(entry => [entry.operation, !!entry.stale]),
    [
      ['WAIT', false],
      ['WAIT', false],
      ['DONE', false]
    ]
  )
})

test('invalid options name the accepted range', async t => {
  await t.throwsAsync(run(new Page(), [], { waitMs: -1 }), {
    message: 'waitMs must be an integer of at least 0.'
  })
  await t.throwsAsync(run(new Page(), [], { maxSteps: 0 }), {
    message: 'maxSteps must be an integer of at least 1.'
  })
})

test('invalid models and reasoning levels fail before any model call', async t => {
  const models = mockModels(['DONE'])
  await t.throwsAsync(agent.goal(new Page(), 'cars', { decisions: {} }), {
    message: 'decisions must be a model id or an AI SDK model.'
  })
  await t.throwsAsync(agent.goal(new Page(), 'cars', { text: '' }), {
    message: 'text must be a model id or an AI SDK model.'
  })
  await t.throwsAsync(run(new Page(), [], { models, reasoning: 'extreme' }), {
    message: /reasoning must be one of: provider-default, none/
  })
  t.is(models.calls.length, 0)
})

test('abort while the decision model responds stops before input', async t => {
  const page = new Page()
  const controller = new AbortController()
  const models = mockModels(['CLICK'], { onDecide: () => controller.abort() })
  await t.throwsAsync(run(page, [], { models, signal: controller.signal }), { name: 'AbortError' })
  t.deepEqual(page.inputs, [])
  t.is(page.listenerCount('popup'), 0)
})

test('concurrent runs on one page are rejected and the first can finish', async t => {
  const page = new Page()
  let release
  const pending = new Promise(resolve => {
    release = resolve
  })
  const models = mockModels(['DONE'])
  const decide = models.decisions.doDecide
  models.decisions.doDecide = async options => {
    await pending
    return decide(options)
  }
  const first = run(page, [], { models })
  await t.throwsAsync(run(page, ['DONE']), { message: /already running/ })
  release()
  t.is((await first).status, 'done')
})

test('a discarded stale decision is reported to the next decision request', async t => {
  const page = new Page([state(), state('Changed')])
  page.guards = [false]
  const models = mockModels(['CLICK', 'DONE'])
  await run(page, [], { models })
  t.deepEqual(models.calls[1].state.recent_actions, [
    { operation: 'CLICK', action: 'e2', stale: true }
  ])
})

test('typing requires keyboard focus on every check after focusing', async t => {
  const page = new Page([state(), state('bmw x3')])
  const requirements = []
  const evaluateHandle = page.evaluateHandle.bind(page)
  page.evaluateHandle = async () => {
    const handle = await evaluateHandle()
    const element = handle.asElement()
    const evaluate = element.evaluate
    element.evaluate = async (fn, ...args) => {
      if (args.length) requirements.push(args[2])
      return evaluate(fn)
    }
    return handle
  }
  await run(page, ['TYPE_TEXT', 'DONE'])
  t.deepEqual(requirements, [{}, { focused: true }, { focused: true }])
})

const populatedState = () => {
  const populated = state('bmw x3')
  populated.actions.unshift({
    id: 'e0',
    node: 1,
    role: 'searchbox',
    label: 'Submit Search',
    kind: 'submit',
    value: 'bmw x3'
  })
  return populated
}

test('SUBMIT presses Enter in the focused field', async t => {
  const page = new Page([populatedState(), state('Results')])
  const result = await run(page, ['SUBMIT', 'DONE'])
  t.is(result.steps, 1)
  t.deepEqual(page.inputs, [{ press: 'Enter' }])
})

test('SUBMIT is discarded when the field does not keep keyboard focus', async t => {
  const page = new Page([populatedState()])
  page.guards = [true, false]
  const result = await run(page, ['SUBMIT', 'DONE'])
  t.true(result.trace[0].stale)
  t.deepEqual(page.inputs, [])
})

const runWithoutDecisionModel = (page, language, options = {}) =>
  agent.goal(page, 'find cheapest bmw x3', {
    text: language.text,
    waitMs: 0,
    ...options
  })

test('without a decision model the language model chooses the operation and target', async t => {
  const page = new Page([state(), state('Results')])
  const language = languageDecider(['CLICK', 'DONE'])
  const result = await runWithoutDecisionModel(page, language)
  t.is(result.status, 'done')
  t.deepEqual(page.inputs, [{ click: true }])
  t.deepEqual(
    language.calls.map(call => call.kind),
    ['decide', 'decide']
  )
  t.deepEqual(
    result.trace.map(entry => [entry.operation, entry.action, entry.confidence]),
    [
      ['CLICK', 'e2', undefined],
      ['DONE', undefined, undefined]
    ]
  )
})

test('without a decision model one language model decides and writes the text', async t => {
  const page = new Page([state(), state('bmw x3')])
  const language = languageDecider(['TYPE_TEXT', 'DONE'])
  await runWithoutDecisionModel(page, language)
  t.deepEqual(page.inputs, [{ selectContents: true }, { text: 'bmw x3' }])
  t.deepEqual(
    language.calls.map(call => call.kind),
    ['decide', 'text', 'decide']
  )
})

test('the language model is offered the same operations and targets as the decision model', async t => {
  const language = languageDecider(['DONE'])
  const models = mockModels(['DONE'])
  await runWithoutDecisionModel(new Page(), language)
  await run(new Page(), [], { models })
  t.deepEqual(language.calls[0].questions, JSON.parse(JSON.stringify(models.calls[0].questions)))
  t.deepEqual(language.calls[0].options.responseFormat.schema.properties.operation.enum, [
    'TYPE_TEXT',
    'CLICK',
    'WAIT',
    'DONE',
    'BLOCKED'
  ])
})

for (const [name, output] of Object.entries({
  'an operation that was not offered': { operation: 'NAVIGATE', target: null },
  'a target that was not offered': { operation: 'CLICK', target: '99' },
  'a missing target': { operation: 'CLICK', target: null },
  'an inherited property as operation': { operation: 'constructor', target: null },
  'an inherited property as target': { operation: 'CLICK', target: 'constructor' },
  'a prototype key as operation': { operation: '__proto__', target: 'constructor' },
  'an array operation': { operation: ['CLICK'], target: '1' },
  'a numeric target': { operation: 'CLICK', target: 1 },
  'an array target': { operation: 'CLICK', target: ['1'] },
  'an object target': { operation: 'CLICK', target: { toString: () => '1' } },
  'a padded target': { operation: 'CLICK', target: ' 1 ' },
  'a lowercase operation': { operation: 'click', target: '1' },
  'a padded operation': { operation: ' CLICK', target: '1' },
  'no operation': {},
  'an array': ['CLICK', '1']
})) {
  test(`a language model decision with ${name} is rejected before input`, async t => {
    const page = new Page()
    const language = languageDecider([output])
    await t.throwsAsync(runWithoutDecisionModel(page, language), {
      message: 'Invalid decisions response; no action executed.'
    })
    t.deepEqual(page.inputs, [])
  })
}

test('the trace records how long each model request took', async t => {
  const page = new Page([state(), state('bmw x3')])
  const result = await run(page, ['TYPE_TEXT', 'DONE'])
  const [typed, done] = result.trace
  t.true(Number.isInteger(typed.decisionMs) && typed.decisionMs >= 0)
  t.true(Number.isInteger(typed.textMs) && typed.textMs >= 0)
  t.true(Number.isInteger(done.decisionMs))
  t.false('textMs' in done)
})

test('a target sent for an operation without targets is ignored', async t => {
  const page = new Page()
  const language = languageDecider([{ operation: 'DONE', target: '1' }])
  const result = await runWithoutDecisionModel(page, language)
  t.is(result.status, 'done')
  t.deepEqual(page.inputs, [])
})

test('language model decisions are timed, including discarded stale ones', async t => {
  const page = new Page([state(), state('Changed')])
  page.guards = [false]
  const language = languageDecider(['CLICK', 'DONE'])
  const result = await runWithoutDecisionModel(page, language)
  t.true(result.trace[0].stale)
  t.true(result.trace.every(entry => Number.isInteger(entry.decisionMs) && entry.decisionMs >= 0))
})

test('the page is given time to settle after each executed input, not after waits or stale decisions', async t => {
  const page = new Page([state(), state('Changed'), state('Changed again'), state('Results')])
  page.guards = [false]
  const result = await run(page, ['CLICK', 'CLICK', 'WAIT', 'DONE'])
  t.deepEqual(
    result.trace.map(entry => [entry.operation, !!entry.stale]),
    [
      ['CLICK', true],
      ['CLICK', false],
      ['WAIT', false],
      ['DONE', false]
    ]
  )
  t.is(page.settles, 1)
})

for (const message of [
  'Node is detached from document',
  'Node is either not clickable or not an Element',
  'Execution context was destroyed, most likely because of a navigation.'
]) {
  test(`a target that vanishes during input is a stale decision: ${message}`, async t => {
    const page = new Page([state(), state('Changed'), state('Results')])
    page.clickErrors = [message]
    const result = await run(page, ['CLICK', 'CLICK', 'DONE'])
    t.true(result.trace[0].stale)
    t.is(result.status, 'done')
    t.deepEqual(page.inputs, [{ click: true }])
  })
}

test('an unrelated input error still stops the run', async t => {
  const page = new Page()
  page.clickErrors = ['Protocol error: session closed']
  await t.throwsAsync(run(page, ['CLICK']), { message: 'Protocol error: session closed' })
})

test('a page that navigates while the target is looked up gives a stale decision', async t => {
  const page = new Page([state(), state('Changed'), state('Results')])
  page.handleErrors = ['Execution context was destroyed, most likely because of a navigation.']
  const result = await run(page, ['CLICK', 'CLICK', 'DONE'])
  t.true(result.trace[0].stale)
  t.deepEqual(page.inputs, [{ click: true }])
})

const INSTRUCTION = 'get the title'

const writtenRules = async (page, instruction, rules, options) => {
  await agent.extract(page, instruction, rules, options)
  return page.appliedRules.at(-1)
}

test('extract with rules runs them without any model request', async t => {
  const page = new Page()
  const models = mockModels([])
  t.deepEqual(await agent.extract(page, RULES, { text: models.text }), DATA)
  t.deepEqual(page.appliedRules, [RULES])
  t.is(models.calls.length, 0)
})

test('extract with an instruction has the model write rules, then runs them', async t => {
  const page = new Page()
  const models = mockModels([])
  t.deepEqual(await agent.extract(page, INSTRUCTION, undefined, { text: models.text }), DATA)
  t.deepEqual(page.appliedRules, [RULES, RULES])
  const [request] = models.calls
  t.is(request.kind, 'rules')
  const user = request.options.prompt.find(message => message.role === 'user')
  t.deepEqual(JSON.parse(user.content[0].text), { instruction: INSTRUCTION, page: PAGE_OUTLINE })
  t.is(models.calls.length, 1)
})

test('rules returns what the model wrote, for reuse', async t => {
  const models = mockModels([])
  t.deepEqual(await writtenRules(new Page(), INSTRUCTION, undefined, { text: models.text }), RULES)
})

test('fields given by the caller keep their names, types and selectors', async t => {
  const written = {
    products: {
      selectorAll: 'article',
      attr: {
        name: { selector: 'h3', attr: 'text', type: 'date' },
        price: { selector: '.price', attr: 'text' },
        extra: { selector: 'b', attr: 'text' }
      }
    },
    unrequested: { selector: 'h1', attr: 'text' }
  }
  const fields = {
    products: { attr: { name: {}, price: { type: 'number', selector: '[data-price]' } } }
  }
  const models = mockModels([], { rules: JSON.stringify(written) })
  const filled = await writtenRules(new Page(), 'get the products', fields, {
    text: models.text
  })
  t.deepEqual(filled, {
    products: {
      selectorAll: 'article',
      attr: {
        name: { selector: 'h3', attr: 'text', type: 'date' },
        price: { type: 'number', selector: '[data-price]' }
      }
    }
  })
  const user = models.calls[0].options.prompt.find(message => message.role === 'user')
  t.deepEqual(JSON.parse(user.content[0].text).fields, fields)
})

for (const [name, reply] of Object.entries({
  'code to evaluate': JSON.stringify({
    title: { selector: 'h1', evaluate: '() => fetch("https://evil.example")' }
  }),
  'an unknown property': JSON.stringify({ title: { selector: 'h1', attr: 'text', click: true } }),
  'a selector that is not a string': JSON.stringify({ title: { selector: 42 } }),
  'an empty object': '{}',
  'an array': JSON.stringify([{ selector: 'h1' }]),
  'text that is not JSON': 'h1'
})) {
  test(`rules written by the model are rejected when they contain ${name}`, async t => {
    const page = new Page()
    const models = mockModels([], { rules: reply })
    await t.throwsAsync(agent.extract(page, INSTRUCTION, undefined, { text: models.text }), {
      message: 'The model did not write usable extraction rules.'
    })
    t.deepEqual(page.appliedRules, [])
  })
}

test('rules passed by the caller are validated before they run', async t => {
  const page = new Page()
  await t.throwsAsync(agent.extract(page, { title: { selector: '' } }), {
    message: 'Invalid rule `data.title`: selector must be a CSS selector or a list of them.'
  })
  await t.throwsAsync(agent.extract(page, { title: { selector: 'h1', evaluate: 'x' } }), {
    message: 'Invalid rule `data.title`: `evaluate` is not supported.'
  })
  await t.throwsAsync(agent.extract({}, RULES), { message: 'extract requires a Puppeteer page.' })
  t.deepEqual(page.appliedRules, [])
})

test('the model reads the page outline once it has stopped changing', async t => {
  const page = new Page()
  const loaded = { ...PAGE_OUTLINE, outline: '<body>\n  <h1> Cars\n  <article>' }
  page.outlines = [
    { ...PAGE_OUTLINE, outline: '<body>' },
    { ...PAGE_OUTLINE, outline: '<body>\n  <h1> Cars' },
    loaded
  ]
  const models = mockModels([])
  await agent.extract(page, INSTRUCTION, undefined, { text: models.text })
  const user = models.calls[0].options.prompt.find(message => message.role === 'user')
  t.deepEqual(JSON.parse(user.content[0].text).page, loaded)
})

test('a custom extractor runs the rules instead of the default engine', async t => {
  const page = new Page()
  const received = []
  const extractor = async (target, rules) => {
    received.push([target, rules])
    return { title: 'From the custom engine' }
  }
  t.deepEqual(await agent.extract(page, RULES, { extractor }), { title: 'From the custom engine' })
  t.deepEqual(received, [[page, RULES]])
  t.deepEqual(page.appliedRules, [])
})

test('a goal makes no extraction request', async t => {
  const models = mockModels(['DONE'])
  await run(new Page(), [], { models })
  t.deepEqual(
    models.calls.map(call => call.kind),
    ['decide']
  )
})

test('agent adds goal and extract to the page, with shared defaults', async t => {
  const models = mockModels(['CLICK', 'DONE'])
  const page = agent(new Page([state(), state('Results')]), {
    decisions: models.decisions,
    text: models.text,
    waitMs: 0
  })
  t.is((await page.goal('find cheapest bmw x3')).status, 'done')
  t.deepEqual(page.inputs, [{ click: true }])
  t.deepEqual(await page.extract(INSTRUCTION), DATA)
  t.deepEqual(await page.extract(RULES), DATA)
})

test('a page that already has extract keeps it as the rules engine', async t => {
  const browserPage = new Page()
  const calls = []
  browserPage.extract = async function (rules) {
    calls.push([this, rules])
    return { title: 'From the page' }
  }
  const models = mockModels([])
  const page = agent(browserPage, { text: models.text })
  t.deepEqual(await page.extract(RULES), { title: 'From the page' })
  t.deepEqual(await page.extract(INSTRUCTION), { title: 'From the page' })
  t.deepEqual(calls, [
    [browserPage, RULES],
    [browserPage, RULES]
  ])
  t.deepEqual(browserPage.appliedRules, [RULES])
})

test('options passed to a page method override the defaults', async t => {
  const models = mockModels(['CLICK'])
  const page = agent(new Page(), { decisions: models.decisions, text: models.text, waitMs: 0 })
  const error = await t.throwsAsync(page.goal('find cars', { maxDecisions: 1, maxSteps: 1 }), {
    instanceOf: agent.BlockedError
  })
  t.is(error.reason, 'step_budget')
})

test('agent requires a Puppeteer page', t => {
  t.throws(() => agent({}), { message: 'agent requires a Puppeteer page.' })
})

test('rules the model wrote are tried on the page before a custom engine runs them', async t => {
  const page = new Page()
  const models = mockModels([])
  const received = []
  const extractor = async (target, rules) => received.push(rules)
  await agent.extract(page, INSTRUCTION, undefined, { text: models.text, extractor })
  t.deepEqual(page.appliedRules, [RULES])
  t.deepEqual(received, [RULES])
})

test('rules written by the model that match nothing are rejected', async t => {
  const page = new Page()
  page.data = {}
  const models = mockModels([])
  await t.throwsAsync(agent.extract(page, INSTRUCTION, undefined, { text: models.text }), {
    message: 'The rules the model wrote matched nothing on the page.'
  })
})

test('rules written by the model with an invalid selector are rejected', async t => {
  const page = new Page()
  page.invalidSelectors = ['#4 9977979 a']
  const models = mockModels([])
  await t.throwsAsync(agent.extract(page, INSTRUCTION, undefined, { text: models.text }), {
    message: 'The model did not write usable extraction rules.'
  })
})

test('rules passed by the caller with an invalid selector name it', async t => {
  const page = new Page()
  page.invalidSelectors = ['#4 9977979 a']
  await t.throwsAsync(agent.extract(page, RULES), {
    message: 'Invalid CSS selector: #4 9977979 a'
  })
})

const fillWith = async (fields, written) => {
  const models = mockModels([], { rules: JSON.stringify(written) })
  return writtenRules(new Page(), 'get the data', fields, { text: models.text })
}

test('a rule the caller wrote in full is kept exactly, alternatives included', async t => {
  const alternatives = [
    { selector: 'h1', attr: 'text' },
    { selector: 'h2', attr: 'text' }
  ]
  const filled = await fillWith(
    { heading: alternatives, title: { selector: 'h1' } },
    { heading: { selectorAll: 'h3' }, title: { selectorAll: 'h2', attr: 'text', type: 'number' } }
  )
  t.deepEqual(filled, { heading: alternatives, title: { selector: 'h1' } })
})

for (const [name, fields, written] of [
  ['omits a field', { price: { type: 'number' } }, { other: { selector: 'p', attr: 'text' } }],
  ['writes no selector', { price: {} }, { price: { attr: 'text' } }],
  [
    'writes a single value where a list of fields was asked',
    { products: { attr: { name: {} } } },
    { products: { selectorAll: 'article', attr: 'text' } }
  ],
  [
    'writes nested rules where a single value was asked',
    { title: {} },
    { title: { selector: 'h1', attr: { hacked: { selector: 'a', attr: 'href' } } } }
  ],
  ['replies with something that is not an object of rules', { title: {} }, ['h1']]
]) {
  test(`fields are not filled when the model ${name}`, async t => {
    await t.throwsAsync(fillWith(fields, written), {
      message: 'The model did not write usable extraction rules.'
    })
  })
}

test('rules that only produce empty items count as matching nothing', async t => {
  const page = new Page()
  page.data = { products: [{ name: null }, { name: null }] }
  const models = mockModels([])
  await t.throwsAsync(agent.extract(page, INSTRUCTION, undefined, { text: models.text }), {
    message: 'The rules the model wrote matched nothing on the page.'
  })
})

test('a custom extractor receives rules the built-in engine would refuse', async t => {
  const hostRules = { title: { evaluate: '() => document.title', type: ['string', 'x'] } }
  const received = []
  const extractor = async (page, rules) => received.push(rules)
  await agent.extract(new Page(), hostRules, { extractor })
  t.deepEqual(received, [hostRules])
})

test('options after an instruction go in third position', async t => {
  const controller = new AbortController()
  controller.abort()
  const models = mockModels([])
  await t.throwsAsync(
    agent.extract(new Page(), INSTRUCTION, undefined, {
      text: models.text,
      signal: controller.signal
    }),
    { name: 'AbortError' }
  )
})

for (const [name, misplaced] of Object.entries({
  'an abort signal': { signal: new AbortController().signal },
  'a timeout': { timeout: 5000 },
  'a model id': { text: 'openai/gpt-6-luna' }
})) {
  test(`options passed where rules belong are refused: ${name}`, async t => {
    const page = new Page()
    const [key] = Object.keys(misplaced)
    await t.throwsAsync(agent.extract(page, INSTRUCTION, misplaced), {
      message: `Invalid rule \`rules.${key}\`: a rule must be an object.`
    })
    t.deepEqual(page.appliedRules, [])
  })
}

test('an instruction with rules that already have every selector makes no model request', async t => {
  const page = new Page()
  const models = mockModels([])
  const complete = {
    products: { selectorAll: 'article', attr: { name: { selector: 'h3', attr: 'text' } } }
  }
  t.deepEqual(await agent.extract(page, INSTRUCTION, complete, { text: models.text }), DATA)
  t.deepEqual(page.appliedRules, [complete])
  t.is(models.calls.length, 0)
})

test('the page method takes rules second and options third', async t => {
  const models = mockModels([], {
    rules: JSON.stringify({ title: { selector: 'h1', attr: 'text' } })
  })
  const page = agent(new Page(), { text: models.text })
  await page.extract(INSTRUCTION, { title: { type: 'string' } }, { timeout: 5000 })
  t.deepEqual(page.appliedRules.at(-1), { title: { selector: 'h1', attr: 'text', type: 'string' } })
  t.false('rules' in page)
})

test('invalid fields name the problem before any model call', async t => {
  const models = mockModels([])
  await t.throwsAsync(
    agent.extract(new Page(), INSTRUCTION, { title: 'h1' }, { text: models.text }),
    { message: 'Invalid rule `rules.title`: a rule must be an object.' }
  )
  t.is(models.calls.length, 0)
})

test('a rule the model wrote without attr reads text, not html', async t => {
  const written = {
    title: { selector: 'h1' },
    products: { selectorAll: 'article', attr: { name: { selector: 'h3' } } }
  }
  const models = mockModels([], { rules: JSON.stringify(written) })
  t.deepEqual(await writtenRules(new Page(), INSTRUCTION, undefined, { text: models.text }), {
    title: { selector: 'h1', attr: 'text' },
    products: { selectorAll: 'article', attr: { name: { selector: 'h3', attr: 'text' } } }
  })
})

test('BLOCKED on a page that is still changing is asked again instead of ending the run', async t => {
  const settling = { ...state('Menu closing'), actions: state().actions.slice(-1) }
  const page = new Page([settling, state('Form ready'), state('Results')])
  const models = mockModels(['BLOCKED', 'CLICK', 'DONE'])
  const result = await run(page, [], { models })
  t.is(result.status, 'done')
  t.deepEqual(
    result.trace.map(entry => entry.operation),
    ['BLOCKED', 'CLICK', 'DONE']
  )
  t.false('TYPE_TEXT' in models.calls[0].questions.operation.criteria)
  t.true('TYPE_TEXT' in models.calls[1].questions.operation.criteria)
})

test('BLOCKED on a page that stays the same ends the run', async t => {
  const page = new Page()
  const models = mockModels(['BLOCKED', 'CLICK'])
  const error = await t.throwsAsync(run(page, [], { models }), { instanceOf: agent.BlockedError })
  t.is(error.reason, 'model_blocked')
  t.is(models.calls.length, 1)
  t.deepEqual(page.inputs, [])
})

test('a page change seen after BLOCKED offers ineffective actions again and resets the no-change count', async t => {
  const settling = { ...state('Menu closing'), actions: state().actions }
  const page = new Page([state(), state(), state(), settling, state('Results')])
  const models = mockModels(['CLICK', 'WAIT', 'BLOCKED', 'CLICK', 'DONE'])
  const result = await run(page, [], { models })
  t.is(result.status, 'done')
  const offersClick = models.calls.map(call => 'click_target' in call.questions)
  t.deepEqual(offersClick, [true, false, false, true, true])
})

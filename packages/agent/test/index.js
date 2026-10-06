'use strict'

const test = require('ava')
const agent = require('..')
const { execute } = require('../src/browser')
const { Page, state, mockModels } = require('./fixtures/page')
const run = (page, operations, { models = mockModels(operations), ...options } = {}) =>
  agent(page, 'find cheapest bmw x3', {
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
  await t.throwsAsync(agent(new Page(), 'cars', { decisions: {} }), {
    message: 'decisions must be a model id or an AI SDK model.'
  })
  await t.throwsAsync(agent(new Page(), 'cars', { text: '' }), {
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

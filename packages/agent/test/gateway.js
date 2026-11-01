'use strict'

const { default: test } = require('ava')
const { createGateway } = require('ai')
const puppeteer = require('puppeteer')

const agent = require('..')
const { Page, state, answer, mockModels } = require('./fixtures/page')

const GOAL = 'find cheapest bmw x3'
const LIVE_TIMEOUT_MS = 120000

const answerFor = (id, { criteria }, operations) => {
  const ids = Object.keys(criteria)
  if (id === 'operation') return answer(operations.shift(), ids)
  if (id === 'passed') return answer('yes', ids)
  return answer(ids[0], ids)
}

const gatewayOver = operations => {
  const requests = []
  const provider = createGateway({
    apiKey: 'test-key',
    fetch: async (url, { body }) => {
      const request = JSON.parse(body)
      requests.push(request)
      const answers = Object.fromEntries(
        Object.entries(request.questions).map(([id, question]) => [
          id,
          answerFor(id, question, operations)
        ])
      )
      return new Response(JSON.stringify({ answers }), {
        headers: { 'content-type': 'application/json' }
      })
    }
  })
  return { provider, requests }
}

test('a goal reaches the gateway as one json state part, profiling included', async t => {
  const { provider, requests } = gatewayOver(['CLICK', 'DONE'])
  const result = await agent.goal(new Page([state(), state('Results')]), GOAL, {
    decisions: provider.decisionModel('typesafe-ai/jev'),
    evaluator: provider.decisionModel('typesafe-ai/jev'),
    text: mockModels([]).text,
    waitMs: 0
  })
  t.is(result.error, undefined)
  t.is(result.status, 'success')
  t.is(result.steps, 1)

  const { accuracy, error } = await result.profiling()
  t.is(error, undefined)
  t.is(accuracy.passed, true)

  t.is(requests.length, 3)
  for (const { stateParts } of requests) {
    t.is(stateParts.length, 1)
    t.is(stateParts[0].type, 'json')
    t.true(stateParts[0].value.elements.length > 0)
  }
  t.deepEqual(Object.keys(requests[2].questions), ['passed'])
  t.is(requests[2].stateParts[0].value.page.text, 'Results')
})

test.serial('a decision model named by id resolves through the default provider', async t => {
  const { provider, requests } = gatewayOver(['DONE'])
  const previous = globalThis.AI_SDK_DEFAULT_PROVIDER
  globalThis.AI_SDK_DEFAULT_PROVIDER = provider
  t.teardown(() => {
    globalThis.AI_SDK_DEFAULT_PROVIDER = previous
  })
  const result = await agent.goal(new Page([state()]), GOAL, {
    text: mockModels([]).text,
    waitMs: 0
  })
  t.is(result.error, undefined)
  t.is(result.status, 'success')
  t.is(requests[0].stateParts[0].type, 'json')
})

const live = process.env.AI_GATEWAY_API_KEY ? test.serial : test.skip

live('a real goal takes real steps against the real gateway', async t => {
  t.timeout(LIVE_TIMEOUT_MS)
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] })
  t.teardown(() => browser.close())
  const page = await browser.newPage()
  await page.setContent(`<h1 id="title">Start</h1>
    <button onclick="document.querySelector('#title').textContent = 'Step two'; this.remove(); document.querySelector('#finish').hidden = false">Next</button>
    <button id="finish" hidden onclick="document.querySelector('#title').textContent = 'All done'">Finish</button>`)
  const result = await agent.goal(
    page,
    'Click Next, then click Finish, until the title says All done',
    {
      maxSteps: 5,
      maxDecisions: 10,
      waitMs: 0
    }
  )
  t.is(result.error, undefined)
  t.is(result.status, 'success')
  t.true(result.steps >= 2)
  t.is(await page.$eval('#title', title => title.textContent), 'All done')
  const { error, cost } = await result.profiling()
  t.is(error, undefined)
  t.true(cost.usd > 0)
})

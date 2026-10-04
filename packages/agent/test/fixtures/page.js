'use strict'

const { EventEmitter } = require('node:events')
const { StaleDecisionError } = require('../../src/errors')

const state = (text = 'Search cars') => ({
  url: 'https://example.com',
  title: 'Cars',
  text,
  w: 800,
  h: 600,
  pageKey: [1],
  guards: { 1: ['identity', 'context'] },
  unsupported: [],
  actions: [
    { id: 'e1', node: 1, role: 'searchbox', label: 'Search', kind: 'fill', value: '' },
    { id: 'e2', node: 1, role: 'searchbox', label: 'Open Search', kind: 'click', value: '' },
    { id: 'wait', kind: 'wait', label: 'Wait for page update' }
  ],
  marker: [text]
})

class Page extends EventEmitter {
  constructor (states = [state()]) {
    super()
    this.states = states
    this.reads = 0
    this.inputs = []
    this.guards = []
    this.disposals = 0
    this.mouse = { move: async () => {}, wheel: async value => this.inputs.push(value) }
    this.keyboard = {
      down: async key => this.inputs.push({ down: key }),
      up: async key => this.inputs.push({ up: key }),
      press: async key => this.inputs.push({ key }),
      insertText: async text => this.inputs.push({ text })
    }
  }

  async evaluate () {
    const index = Math.min(this.reads++, this.states.length - 1)
    return this.states[index]
  }

  async evaluateHandle () {
    const page = this
    const element = {
      evaluate: async fn =>
        fn.toString().includes('navigator.platform')
          ? 'Control'
          : page.guards.length
            ? page.guards.shift()
            : true,
      focus: async () => {
        if (page.onFocus) page.onFocus()
      },
      click: async () => page.inputs.push({ click: true }),
      select: async value => page.inputs.push({ select: value })
    }
    return {
      asElement: () => element,
      dispose: async () => {
        page.disposals++
      }
    }
  }
}

const answer = (choice, ids) => ({
  choice,
  confidence: 1,
  probabilities: Object.fromEntries(ids.map(id => [id, Number(choice === id)]))
})
const mockFetch = (operations, { targets = {}, text = '{"text":"bmw x3"}', onRequest } = {}) => {
  const calls = []
  const fetch = async (url, request) => {
    const body = JSON.parse(request.body)
    calls.push({ url, body })
    if (onRequest) onRequest(body)
    if (url.endsWith('/chat/completions')) { return { ok: true, json: async () => ({ choices: [{ message: { content: text } }] }) } }
    const operation = operations.shift()
    const answers = { operation: answer(operation, Object.keys(body.questions.operation.criteria)) }
    for (const [key, question] of Object.entries(body.questions)) {
      if (key !== 'operation') {
        answers[key] = answer(
          targets[key] || Object.keys(question.criteria)[0],
          Object.keys(question.criteria)
        )
      }
    }
    return { ok: true, json: async () => ({ answers }) }
  }
  fetch.calls = calls
  return fetch
}

const provider = { apiKey: 'fixture-key', baseUrl: 'https://fixture.invalid/v1', model: 'fixture' }
module.exports = { Page, state, answer, mockFetch, provider, StaleDecisionError }

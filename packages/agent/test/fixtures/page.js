'use strict'

const { EventEmitter } = require('node:events')
const { StaleDecisionError } = require('../../src/errors')
const { selectContents, settled, pageOutline } = require('../../src/browser')
const { evaluateRules } = require('../../src/rules')
const { MockLanguageModelV4 } = require('ai/test')

const RULES = { title: { selector: 'h1', attr: 'text' } }
const DATA = { title: 'Cars' }
const PAGE_OUTLINE = { url: 'https://example.com', title: 'Cars', outline: '<body>\n  <h1> Cars' }

const PROMPT_KINDS = { 'Choose the next browser': 'decide', 'Write data extraction rules': 'rules' }

const promptKind = options => {
  const system = options.prompt.find(message => message.role === 'system')?.content ?? ''
  const prefix = Object.keys(PROMPT_KINDS).find(start => system.startsWith(start))
  return PROMPT_KINDS[prefix] ?? 'text'
}

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
    this.settles = 0
    this.clickErrors = []
    this.handleErrors = []
    this.outlines = [PAGE_OUTLINE]
    this.appliedRules = []
    this.data = DATA
    this.invalidSelectors = []
    this.mouse = { move: async () => {}, wheel: async value => this.inputs.push(value) }
    this.keyboard = {
      sendCharacter: async text => this.inputs.push({ text }),
      press: async key => this.inputs.push({ press: key })
    }
  }

  async evaluate (fn, ...args) {
    if (fn === settled) {
      this.settles++
      return
    }
    if (fn === pageOutline) {
      return this.outlines.length > 1 ? this.outlines.shift() : this.outlines[0]
    }
    if (fn === evaluateRules) {
      this.appliedRules.push(args[0])
      return { values: this.data, invalidSelectors: this.invalidSelectors }
    }
    const index = Math.min(this.reads++, this.states.length - 1)
    return this.states[index]
  }

  async evaluateHandle () {
    if (this.handleErrors.length) throw new Error(this.handleErrors.shift())
    const page = this
    const element = {
      evaluate: async fn => {
        if (fn === selectContents) return page.inputs.push({ selectContents: true })
        return page.guards.length ? page.guards.shift() : true
      },
      focus: async () => {
        if (page.onFocus) page.onFocus()
      },
      click: async () => {
        if (page.clickErrors.length) throw new Error(page.clickErrors.shift())
        page.inputs.push({ click: true })
      },
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
  type: 'choice',
  choice,
  probabilities: Object.fromEntries(ids.map(id => [id, Number(choice === id)]))
})

const decisionModel = doDecide => ({
  specificationVersion: 'v4',
  provider: 'fixture',
  modelId: 'fixture-decisions',
  supportedQuestionTypes: ['choice'],
  doDecide
})

const textModel = text =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text }],
      finishReason: { unified: 'stop', raw: 'stop' },
      usage: {
        inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
        outputTokens: { total: 1, text: 1, reasoning: 0 }
      },
      warnings: []
    })
  })

const mockModels = (
  operations,
  { targets = {}, text = '{"text":"bmw x3"}', rules = JSON.stringify(RULES), onDecide, onText } = {}
) => {
  const calls = []
  const decisions = decisionModel(async ({ state, questions }) => {
    calls.push({ kind: 'decide', state, questions })
    if (onDecide) onDecide({ state, questions })
    const operation = operations.shift()
    const answers = { operation: answer(operation, Object.keys(questions.operation.criteria)) }
    for (const [key, question] of Object.entries(questions)) {
      if (key !== 'operation') {
        answers[key] = answer(
          targets[key] || Object.keys(question.criteria)[0],
          Object.keys(question.criteria)
        )
      }
    }
    return { answers, warnings: [] }
  })
  const replies = { text: textModel(text).doGenerate, rules: textModel(rules).doGenerate }
  const textGenerator = textModel(text)
  textGenerator.doGenerate = async options => {
    const kind = promptKind(options)
    calls.push({ kind, options })
    if (kind === 'text' && onText) onText(options)
    return replies[kind](options)
  }
  return { decisions, text: textGenerator, calls }
}

const languageDecider = (
  operations,
  { targets = {}, text = '{"text":"bmw x3"}', rules = JSON.stringify(RULES) } = {}
) => {
  const calls = []
  const generated = content => ({
    content: [{ type: 'text', text: content }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: {
      inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
      outputTokens: { total: 1, text: 1, reasoning: 0 }
    },
    warnings: []
  })
  const model = new MockLanguageModelV4({
    doGenerate: async options => {
      const kind = promptKind(options)
      if (kind !== 'decide') {
        calls.push({ kind, options })
        return generated(kind === 'rules' ? rules : text)
      }
      const user = options.prompt.find(message => message.role === 'user')
      const request = JSON.parse(user.content[0].text)
      calls.push({ kind: 'decide', options, ...request })
      const next = operations.shift()
      if (typeof next !== 'string') return generated(JSON.stringify(next))
      const question = request.questions[`${next.toLowerCase()}_target`]
      const target = question ? targets[next] || Object.keys(question.criteria)[0] : null
      return generated(JSON.stringify({ operation: next, target }))
    }
  })
  return { text: model, calls }
}

module.exports = {
  RULES,
  DATA,
  PAGE_OUTLINE,
  languageDecider,
  Page,
  state,
  answer,
  decisionModel,
  textModel,
  mockModels,
  StaleDecisionError
}

'use strict'

const { observe, execute, settle, pageChanged, readStableOutline } = require('./browser')
const { decide, decideWithLanguageModel, fieldText, writeRules, invalidRules } = require('./model')
const { applyRules, assertRules, fillFields, readingTextByDefault, hasData } = require('./rules')
const { BlockedError, StaleDecisionError } = require('./errors')

const DEFAULT_LIMITS = { maxSteps: 60, maxDecisions: 120, waitMs: 100, timeout: 25000 }
const MINIMUM_LIMITS = { maxSteps: 1, maxDecisions: 1, waitMs: 0, timeout: 1 }
const DEFAULT_TEXT_MODEL = 'openai/gpt-6-luna'
const DEFAULT_REASONING = 'none'
const REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const MAX_UNCHANGED_ACTIONS = 3
const MAX_STALE_DECISIONS_PER_TARGET = 3
const BLOCKED_RECHECK_MS = 300
const VERIFICATION_WALL =
  /\b(captcha|verify you are human|verification required|verifica que eres humano)\b/i

const activePages = new WeakSet()

const isModel = model =>
  (typeof model === 'string' && model.trim() !== '') ||
  typeof model?.specificationVersion === 'string'

const withDefaults = (options, defaults) =>
  Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, options[key] ?? value]))

const resolveOptions = options => {
  const limits = withDefaults(options, DEFAULT_LIMITS)
  for (const [key, minimum] of Object.entries(MINIMUM_LIMITS)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < minimum) {
      throw new TypeError(`${key} must be an integer of at least ${minimum}.`)
    }
  }
  const models = {
    decisions: options.decisions ?? undefined,
    text: options.text ?? DEFAULT_TEXT_MODEL
  }
  for (const [key, model] of Object.entries(models)) {
    const required = key === 'text'
    if ((required || model !== undefined) && !isModel(model)) {
      throw new TypeError(`${key} must be a model id or an AI SDK model.`)
    }
  }
  const reasoning = options.reasoning ?? DEFAULT_REASONING
  if (!REASONING_LEVELS.includes(reasoning)) {
    throw new TypeError(`reasoning must be one of: ${REASONING_LEVELS.join(', ')}.`)
  }
  return { ...limits, models, reasoning }
}

const blockingSurface = state => {
  if (VERIFICATION_WALL.test(state.text)) {
    return ['captcha', 'A possible human-verification wall is visible; no bypass attempted.']
  }
  if (state.unsupported?.includes('password')) {
    return ['login_wall', 'A visible password field requires manual login.']
  }
  if (state.unsupported?.length) {
    return ['unsupported_surface', `Visible unsupported surface: ${state.unsupported.join(', ')}.`]
  }
}

const actionKey = action => `${action.kind}:${action.node ?? action.id}:${action.value ?? ''}`

const staleTargetKey = ({ operation, action }) => `${operation}:${action.node ?? action.id}`

const timed = async call => {
  const started = performance.now()
  const value = await call()
  return [value, Math.round(performance.now() - started)]
}

const isPage = page => typeof page?.evaluate === 'function'

const isInstruction = text => typeof text === 'string' && text.trim() !== ''

const goal = async (page, goal, options = {}) => {
  if (!isPage(page) || !isInstruction(goal)) {
    throw new TypeError('goal requires a Puppeteer page and a nonempty goal.')
  }
  if (activePages.has(page)) throw new TypeError('A goal is already running on this page.')
  const { maxSteps, maxDecisions, waitMs, timeout, models, reasoning } = resolveOptions(options)
  const request = { timeout, signal: options.signal, reasoning }
  const trace = []
  const ineffectiveActions = new Set()
  let steps = 0
  let decisions = 0
  let unchanged = 0
  let staleTarget
  let staleDecisions = 0
  let popup = false
  const onPopup = () => {
    popup = true
  }
  const blocked = (reason, message) => {
    throw new BlockedError(reason, message, trace)
  }
  activePages.add(page)
  page.on('popup', onPopup)
  try {
    let state = await observe(page)
    while (true) {
      options.signal?.throwIfAborted()
      if (popup) {
        blocked(
          'unsupported_surface',
          'Popup tabs are not supported; the original page was retained.'
        )
      }
      const surface = blockingSurface(state)
      if (surface) blocked(...surface)
      if (decisions >= maxDecisions) blocked('step_budget', 'Decision-request budget exhausted.')
      decisions++
      const offered = {
        ...state,
        actions: state.actions.filter(action => !ineffectiveActions.has(actionKey(action)))
      }
      const [decision, decisionMs] = await timed(() =>
        models.decisions
          ? decide(offered, goal, trace, models.decisions, request)
          : decideWithLanguageModel(offered, goal, trace, models.text, request)
      )
      const entry = {
        ...decision,
        action: decision.action?.id,
        step: steps,
        decision: decisions,
        decisionMs
      }
      trace.push(entry)
      if (decision.operation === 'DONE') return { status: 'done', steps, decisions, trace }
      if (decision.operation === 'BLOCKED') {
        await new Promise(resolve => setTimeout(resolve, BLOCKED_RECHECK_MS))
        const recheck = await observe(page)
        if (!pageChanged(state, recheck)) {
          blocked('model_blocked', 'The model found no supported operation to progress.')
        }
        entry.pageChanged = true
        unchanged = 0
        ineffectiveActions.clear()
        state = recheck
        continue
      }
      if (steps >= maxSteps) blocked('step_budget', 'Action budget exhausted.')
      if (unchanged >= MAX_UNCHANGED_ACTIONS) {
        blocked('no_change', 'Three consecutive actions did not change the observed page.')
      }
      let text
      if (decision.operation === 'TYPE_TEXT') {
        ;[text, entry.textMs] = await timed(() =>
          fieldText(goal, decision.action, state, trace, models.text, request)
        )
        entry.text = text
      }
      options.signal?.throwIfAborted()
      if (popup) {
        blocked('unsupported_surface', 'A popup appeared during the decision; no input executed.')
      }
      try {
        await execute(page, state, decision.action, text, waitMs)
      } catch (error) {
        if (!(error instanceof StaleDecisionError)) throw error
        entry.stale = true
        const target = staleTargetKey(decision)
        staleDecisions = target === staleTarget ? staleDecisions + 1 : 1
        staleTarget = target
        if (staleDecisions >= MAX_STALE_DECISIONS_PER_TARGET) {
          blocked(
            'stale_target',
            `${MAX_STALE_DECISIONS_PER_TARGET} consecutive decisions chose a target that failed its freshness check.`
          )
        }
        state = await observe(page)
        continue
      }
      staleTarget = undefined
      steps++
      if (decision.action.kind !== 'wait') await settle(page, decision.action)
      const next = await observe(page)
      entry.pageChanged = pageChanged(state, next)
      unchanged = entry.pageChanged ? 0 : unchanged + 1
      if (entry.pageChanged) ineffectiveActions.clear()
      else if (decision.action.kind !== 'wait') ineffectiveActions.add(actionKey(decision.action))
      state = next
    }
  } catch (error) {
    if (error instanceof BlockedError && error.trace.length === 0) error.trace = trace
    throw error
  } finally {
    page.off('popup', onPopup)
    activePages.delete(page)
  }
}

const usableRules = async (page, written, fields) => {
  let rules
  let values
  try {
    rules = readingTextByDefault(assertRules(written))
    if (fields) rules = fillFields(fields, rules)
    values = await applyRules(page, rules)
  } catch (error) {
    if (error instanceof TypeError) throw invalidRules(error)
    throw error
  }
  if (!hasData(values)) {
    throw new TypeError('The rules the model wrote matched nothing on the page.')
  }
  return rules
}

const rules = async (page, instruction, options = {}) => {
  if (!isPage(page) || !isInstruction(instruction)) {
    throw new TypeError('rules requires a Puppeteer page and a nonempty instruction.')
  }
  const { fields } = options
  if (fields !== undefined) assertRules(fields, 'fields')
  const { timeout, models, reasoning } = resolveOptions(options)
  const request = { timeout, signal: options.signal, reasoning }
  const outline = await readStableOutline(page)
  const written = await writeRules(instruction, outline, fields, models.text, request)
  return usableRules(page, written, fields)
}

const extract = async (page, input, options = {}) => {
  if (!isPage(page)) throw new TypeError('extract requires a Puppeteer page.')
  const { extractor = applyRules } = options
  return extractor(page, typeof input === 'string' ? await rules(page, input, options) : input)
}

const agent = (page, defaults = {}) => {
  if (!isPage(page)) throw new TypeError('agent requires a Puppeteer page.')
  const existingExtract = typeof page.extract === 'function' ? page.extract.bind(page) : undefined
  const extractor = defaults.extractor ?? (existingExtract && ((_, data) => existingExtract(data)))
  const settings = extractor ? { ...defaults, extractor } : defaults
  const withSettings = options => ({ ...settings, ...options })
  return Object.assign(page, {
    goal: (text, options) => goal(page, text, withSettings(options)),
    rules: (instruction, options) => rules(page, instruction, withSettings(options)),
    extract: (input, options) => extract(page, input, withSettings(options))
  })
}

module.exports = agent
module.exports.goal = goal
module.exports.rules = rules
module.exports.extract = extract
module.exports.applyRules = applyRules
module.exports.BlockedError = BlockedError

'use strict'

const { observe, execute, pageChanged } = require('./browser')
const { decide, fieldText } = require('./model')
const { BlockedError, StaleDecisionError } = require('./errors')

const DEFAULT_LIMITS = { maxSteps: 60, maxDecisions: 120, waitMs: 100, timeout: 25000 }
const MINIMUM_LIMITS = { maxSteps: 1, maxDecisions: 1, waitMs: 0, timeout: 1 }
const DEFAULT_MODELS = { decisions: 'typesafe-ai/jev', text: 'inception/mercury-2.5' }
const DEFAULT_REASONING = 'none'
const REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const MAX_UNCHANGED_ACTIONS = 3
const MAX_STALE_DECISIONS_PER_TARGET = 3
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
  const models = withDefaults(options, DEFAULT_MODELS)
  for (const [key, model] of Object.entries(models)) {
    if (!isModel(model)) throw new TypeError(`${key} must be a model id or an AI SDK model.`)
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

const agent = async (page, goal, options = {}) => {
  if (!page || typeof page.evaluate !== 'function' || typeof goal !== 'string' || !goal.trim()) {
    throw new TypeError('agent requires a Puppeteer page and a nonempty goal.')
  }
  if (activePages.has(page)) throw new TypeError('An agent is already running on this page.')
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
      const decision = await decide(offered, goal, trace, models.decisions, request)
      const entry = { ...decision, action: decision.action?.id, step: steps, decision: decisions }
      trace.push(entry)
      if (decision.operation === 'DONE') return { status: 'done', steps, decisions, trace }
      if (decision.operation === 'BLOCKED') {
        blocked('model_blocked', 'The model found no supported operation to progress.')
      }
      if (steps >= maxSteps) blocked('step_budget', 'Action budget exhausted.')
      if (unchanged >= MAX_UNCHANGED_ACTIONS) {
        blocked('no_change', 'Three consecutive actions did not change the observed page.')
      }
      let text
      if (decision.operation === 'TYPE_TEXT') {
        text = await fieldText(goal, decision.action, state, trace, models.text, request)
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

module.exports = agent
module.exports.BlockedError = BlockedError

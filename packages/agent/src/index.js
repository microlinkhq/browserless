'use strict'

const { observe, execute } = require('./browser')
const { provider, decide, fieldText } = require('./model')
const { BlockedError, StaleDecisionError } = require('./errors')
const activePages = new WeakSet()
const MAX_STALE_DECISIONS_PER_TARGET = 3

const actionKey = action => `${action.kind}:${action.node ?? action.id}:${action.value ?? ''}`

const agent = async (page, goal, options = {}) => {
  if (!page || typeof page.evaluate !== 'function' || typeof goal !== 'string' || !goal.trim()) {
    throw new TypeError('agent requires a Puppeteer page and a nonempty goal.')
  }
  if (activePages.has(page)) throw new TypeError('An agent is already running on this page.')
  const maxSteps = options.maxSteps ?? 60
  const maxDecisions = options.maxDecisions ?? 120
  const waitMs = options.waitMs ?? 100
  const timeout = options.timeout ?? 25000
  for (const [key, value] of Object.entries({ maxSteps, maxDecisions, waitMs, timeout })) {
    const minimum = key === 'waitMs' ? 0 : 1
    if (!Number.isSafeInteger(value) || value < minimum) {
      throw new TypeError(`${key} must be an integer of at least ${minimum}.`)
    }
  }
  const config = provider(
    options.decisions,
    options.decisions
      ? {}
      : {
          apiKey: process.env.TYPESAFE_API_KEY,
          baseUrl: process.env.TYPESAFE_BASE_URL || 'https://api.typesafe.ai/v1',
          model: process.env.TYPESAFE_MODEL || 'jev-latest'
        }
  )
  const http = { fetch: options.fetch ?? globalThis.fetch, timeout, signal: options.signal }
  const trace = []
  let steps = 0
  let decisions = 0
  let unchanged = 0
  let popup = false
  let staleTarget
  const ineffectiveActions = new Set()
  let staleDecisions = 0
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
      if (
        /\b(captcha|verify you are human|verification required|verifica que eres humano)\b/i.test(
          state.text
        )
      ) {
        blocked('captcha', 'A possible human-verification wall is visible; no bypass attempted.')
      }
      if (state.unsupported?.includes('password')) {
        blocked('login_wall', 'A visible password field requires manual login.')
      }
      if (state.unsupported?.length) {
        blocked(
          'unsupported_surface',
          `Visible unsupported surface: ${state.unsupported.join(', ')}.`
        )
      }
      if (decisions >= maxDecisions) blocked('step_budget', 'Decision-request budget exhausted.')
      decisions++
      const offered = {
        ...state,
        actions: state.actions.filter(action => !ineffectiveActions.has(actionKey(action)))
      }
      const decision = await decide(offered, goal, trace, config, http)
      const entry = { ...decision, action: decision.action?.id, step: steps, decision: decisions }
      trace.push(entry)
      if (decision.operation === 'DONE') return { status: 'done', steps, decisions, trace }
      if (decision.operation === 'BLOCKED') {
        blocked('model_blocked', 'The model found no supported operation to progress.')
      }
      if (steps >= maxSteps) blocked('step_budget', 'Action budget exhausted.')
      if (unchanged >= 3) {
        blocked('no_change', 'Three consecutive actions did not change the observed page.')
      }
      let text
      if (decision.operation === 'TYPE_TEXT') {
        const textConfig = provider(
          options.text,
          options.text
            ? {}
            : {
                apiKey: process.env.TEXT_MODEL_API_KEY,
                baseUrl: process.env.TEXT_MODEL_BASE_URL,
                model: process.env.TEXT_MODEL,
                reasoning: process.env.TEXT_MODEL_REASONING || undefined
              }
        )
        text = await fieldText(goal, decision.action, state, trace, textConfig, http)
        entry.text = text
      }
      options.signal?.throwIfAborted()
      if (popup) {
        blocked('unsupported_surface', 'A popup appeared during the decision; no input executed.')
      }
      // The generative helper may be slow. Every action is guarded afterward.
      try {
        await execute(page, state, decision.action, text, waitMs)
      } catch (error) {
        if (!(error instanceof StaleDecisionError)) throw error
        entry.stale = true
        const target = `${decision.operation}:${decision.action.node ?? decision.action.id}`
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
      entry.pageChanged = JSON.stringify(next.marker) !== JSON.stringify(state.marker)
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

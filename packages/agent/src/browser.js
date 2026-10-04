/* global location, innerWidth, innerHeight */
'use strict'

const snapshot = require('./snapshot')
const { BlockedError, StaleDecisionError } = require('./errors')

const observe = async page => {
  const state = await page.evaluate(snapshot)
  if (!state) throw new BlockedError('unsupported_surface', 'No document body is available.')
  return state
}

// Geometry is resolved now, not from model-time coordinates. Form state is local
// to the target; unrelated page changes do not invalidate this decision.
const targetFresh = (element, state, action) => {
  const cache = window.__browserlessAgent
  if (
    !cache ||
    !element?.isConnected ||
    cache.nodes.get(action.node) !== element ||
    JSON.stringify(cache.guard(element)) !== JSON.stringify(state.guards[action.node]) ||
    performance.timeOrigin !== state.pageKey[0] ||
    location.href !== state.url ||
    element.closest('[aria-disabled="true"],[inert]') ||
    ['password', 'file', 'hidden'].includes(element.type)
  ) { return false }
  const r = element.getBoundingClientRect()
  const x = r.x + r.width / 2
  const y = r.y + r.height / 2
  if (
    !r.width ||
    !r.height ||
    x < 0 ||
    y < 0 ||
    x >= innerWidth ||
    y >= innerHeight ||
    !element.contains(document.elementFromPoint(x, y))
  ) { return false }
  if (
    action.kind === 'fill' &&
    (element.readOnly || element.getAttribute('aria-readonly') === 'true')
  ) { return false }
  if (
    action.kind === 'select' &&
    (element.tagName !== 'SELECT' ||
      ![...element.options].some(
        o => o.value === action.value && !o.disabled && !o.closest('optgroup[disabled]')
      ))
  ) { return false }
  return true
}

const execute = async (page, state, action, text, waitMs) => {
  if (action.kind === 'wait' || action.kind === 'scroll') {
    const current = await observe(page)
    if (JSON.stringify(current.marker) !== JSON.stringify(state.marker)) { throw new StaleDecisionError() }
    if (action.kind === 'wait') await new Promise(resolve => setTimeout(resolve, waitMs))
    else {
      await page.mouse.move(state.w / 2, state.h / 2)
      await page.mouse.wheel({ deltaY: action.delta })
    }
    return
  }
  const handle = await page.evaluateHandle(
    node => window.__browserlessAgent?.nodes.get(node) || null,
    action.node
  )
  try {
    const element = handle.asElement()
    if (!element || !(await element.evaluate(targetFresh, state, action))) { throw new StaleDecisionError() }
    if (action.kind === 'fill') {
      // Focus can trigger menus/re-renders. Validate again before changing value.
      await element.focus()
      if (!(await element.evaluate(targetFresh, state, action))) throw new StaleDecisionError()
      const modifier = await element.evaluate(() =>
        /Mac/.test(navigator.platform) ? 'Meta' : 'Control'
      )
      if (!(await element.evaluate(targetFresh, state, action))) throw new StaleDecisionError()
      await page.keyboard.down(modifier)
      try {
        await page.keyboard.press('A')
      } finally {
        await page.keyboard.up(modifier)
      }
      if (!(await element.evaluate(targetFresh, state, action))) throw new StaleDecisionError()
      if (!(await element.evaluate(targetFresh, state, action))) throw new StaleDecisionError()
      await page.keyboard.insertText(text)
    } else if (action.kind === 'select') {
      await element.select(action.value)
    } else if (action.kind === 'click') {
      await element.click()
    } else throw new TypeError('Unknown observed action.')
  } finally {
    await handle.dispose()
  }
}

module.exports = { observe, execute, targetFresh }

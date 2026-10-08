/* global location, innerWidth, innerHeight, getSelection, requestAnimationFrame */
'use strict'

const snapshot = require('./snapshot')
const pageOutline = require('./outline')
const { BlockedError, StaleDecisionError } = require('./errors')

const KEYBOARD_TARGET = { focused: true }
const SETTLE_LIMITS = { autocompleteMs: 200, defaultMs: 50, minFrames: 2 }
const BUSY_LIMIT_MS = 3000
const BUSY_POLL_MS = 50
const DOCUMENT_READY_LIMIT_MS = 3000
const DOCUMENT_READY_POLL_MS = 50
const OUTLINE_LIMITS = { characters: 60000, text: 80, attribute: 80, siblings: 3 }
const OUTLINE_STABLE_POLL_MS = 250
const OUTLINE_STABLE_LIMIT_MS = 3000

const pageChanged = (before, after) =>
  JSON.stringify(before.marker) !== JSON.stringify(after.marker)

const NAVIGATING = /Execution context was destroyed|Cannot find context with specified id/
const TARGET_GONE = new RegExp(
  `${NAVIGATING.source}|Node is detached from document|not clickable or not an Element`
)

// Puppeteer's isolated world shares the DOM and hides its window from page scripts.
const agentWorld = page => {
  const frame = typeof page.mainFrame === 'function' ? page.mainFrame() : undefined
  const isolated = typeof frame?.isolatedRealm === 'function' ? frame.isolatedRealm() : undefined
  return typeof isolated?.evaluate === 'function' ? isolated : page
}

const snapshotUnlessNavigating = page =>
  agentWorld(page)
    .evaluate(snapshot)
    .catch(error => {
      if (NAVIGATING.test(error.message)) return null
      throw error
    })

const observe = async page => {
  const deadline = Date.now() + DOCUMENT_READY_LIMIT_MS
  while (true) {
    const state = await snapshotUnlessNavigating(page)
    if (state) return state
    if (Date.now() >= deadline) {
      throw new BlockedError('unsupported_surface', 'No document body is available.')
    }
    await new Promise(resolve => setTimeout(resolve, DOCUMENT_READY_POLL_MS))
  }
}

// Geometry is resolved now, not from model-time coordinates. Form state is local
// to the target; unrelated page changes do not invalidate this decision.
const targetFresh = (element, state, action, requirements = {}) => {
  const cache = window.__browserlessAgent
  if (
    !cache ||
    !element?.isConnected ||
    cache.nodes.get(action.node) !== element ||
    JSON.stringify(cache.guard(element)) !== JSON.stringify(state.guards[action.node]) ||
    performance.timeOrigin !== state.pageKey[0] ||
    location.href !== state.url ||
    cache.closest(element, '[aria-disabled="true"],[inert]') ||
    ['password', 'file', 'hidden'].includes(element.type)
  ) {
    return false
  }
  if (requirements.focused && cache.activeElement() !== element) return false
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
    !cache.contains(element, cache.elementFromPoint(x, y))
  ) {
    return false
  }
  if (
    action.kind === 'fill' &&
    (element.readOnly || element.getAttribute('aria-readonly') === 'true')
  ) {
    return false
  }
  if (
    action.kind === 'select' &&
    (element.tagName !== 'SELECT' ||
      ![...element.options].some(
        o => o.value === action.value && !o.disabled && !o.closest('optgroup[disabled]')
      ))
  ) {
    return false
  }
  return true
}

const selectContents = element => {
  if (typeof element.select === 'function') element.select()
  else getSelection().selectAllChildren(element)
}

const readOutline = page => page.evaluate(pageOutline, OUTLINE_LIMITS)

const readStableOutline = async page => {
  const deadline = Date.now() + OUTLINE_STABLE_LIMIT_MS
  let current = await readOutline(page)
  while (Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, OUTLINE_STABLE_POLL_MS))
    const next = await readOutline(page)
    if (next.outline === current.outline) return next
    current = next
  }
  return current
}

const settled = (action, limits) =>
  new Promise(resolve => {
    const field = window.__browserlessAgent?.nodes.get(action.node)
    const autocomplete = action.kind === 'fill' && field?.getAttribute('role') === 'combobox'
    const visibleOptions = () => {
      const ids = (field.getAttribute('aria-controls') || field.getAttribute('aria-owns') || '')
        .split(/\s+/)
        .filter(Boolean)
      const roots = ids.length
        ? ids.map(id => field.getRootNode().getElementById(id)).filter(Boolean)
        : [document]
      return roots
        .flatMap(root => [...root.querySelectorAll('[role="option"]')])
        .filter(option => {
          const r = option.getBoundingClientRect()
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.bottom > 0 &&
            r.top < innerHeight &&
            option.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
          )
        })
    }
    // Options already on screen are not this field's new suggestions.
    const alreadyVisible = new Set(autocomplete ? visibleOptions() : [])
    const suggestionVisible = () => visibleOptions().some(option => !alreadyVisible.has(option))
    let frames = 0
    let finished = false
    const finish = () => {
      finished = true
      resolve()
    }
    const onFrame = () => {
      if (finished) return
      if (++frames >= limits.minFrames && (!autocomplete || suggestionVisible())) finish()
      else requestAnimationFrame(onFrame)
    }
    setTimeout(finish, autocomplete ? limits.autocompleteMs : limits.defaultMs)
    requestAnimationFrame(onFrame)
  })

// Navigation can destroy the page context mid-wait; the next observation handles that.
const untilIdle = (action, limitMs, pollMs) =>
  new Promise(resolve => {
    const started = Date.now()
    const field = window.__browserlessAgent?.nodes.get(action.node)
    const roots = [document]
    for (const root of roots) {
      for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot) roots.push(element.shadowRoot)
      }
    }
    const all = selector => roots.flatMap(root => [...root.querySelectorAll(selector)])
    const shown = element =>
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
    const busy = () => {
      if (field?.isConnected && field.matches(':disabled')) return true
      if (all('[aria-busy="true"]').some(shown)) return true
      return all('progress,[role="progressbar"]').some(element => {
        if (!shown(element)) return false
        if (element.tagName === 'PROGRESS') return element.position < 0
        return element.getAttribute('aria-valuenow') == null
      })
    }
    const poll = () => {
      if (!busy() || Date.now() - started >= limitMs) resolve()
      else setTimeout(poll, pollMs)
    }
    poll()
  })

const settle = async (page, action) => {
  await agentWorld(page)
    .evaluate(settled, action, SETTLE_LIMITS)
    .catch(() => {})
  await agentWorld(page)
    .evaluate(untilIdle, action, BUSY_LIMIT_MS, BUSY_POLL_MS)
    .catch(() => {})
}

const execute = async (page, state, action, text, waitMs) => {
  if (action.kind === 'wait') {
    await new Promise(resolve => setTimeout(resolve, waitMs))
    return
  }
  if (action.kind === 'scroll') {
    if (pageChanged(state, await observe(page))) throw new StaleDecisionError()
    await page.mouse.move(state.w / 2, state.h / 2)
    await page.mouse.wheel({ deltaY: action.delta })
    return
  }
  let handle
  try {
    handle = await agentWorld(page).evaluateHandle(
      node => window.__browserlessAgent?.nodes.get(node) || null,
      action.node
    )
    const element = handle.asElement()
    const assertFresh = async (requirements = {}) => {
      if (!(await element?.evaluate(targetFresh, state, action, requirements))) {
        throw new StaleDecisionError()
      }
    }
    // Focus can trigger menus/re-renders, so freshness is checked again after it.
    const focusForKeyboard = async () => {
      await element.focus()
      await assertFresh(KEYBOARD_TARGET)
    }
    await assertFresh()
    if (action.kind === 'fill') {
      await focusForKeyboard()
      await element.evaluate(selectContents)
      await assertFresh(KEYBOARD_TARGET)
      await page.keyboard.sendCharacter(text)
    } else if (action.kind === 'submit') {
      await focusForKeyboard()
      await page.keyboard.press('Enter')
    } else if (action.kind === 'select') {
      await element.select(action.value)
    } else if (action.kind === 'click') {
      await element.click()
    } else throw new TypeError('Unknown observed action.')
  } catch (error) {
    if (TARGET_GONE.test(error.message)) throw new StaleDecisionError()
    throw error
  } finally {
    await handle?.dispose().catch(() => {})
  }
}

module.exports = {
  agentWorld,
  readStableOutline,
  pageOutline,
  observe,
  execute,
  settle,
  settled,
  untilIdle,
  pageChanged,
  targetFresh,
  selectContents
}

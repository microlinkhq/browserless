'use strict'

const LOCATOR_KEYS = ['selector', 'role', 'text', 'label', 'placeholder', 'testId', 'alt']

const escape = value => String(value).replaceAll('"', '\\"')

/**
 * Compile an action's locator fields into a Puppeteer P-selector string.
 *
 * @param {Record<string, *>} action
 * @returns {string}
 */
const toSelector = action => {
  if (action.selector) return action.selector
  if (action.role) {
    const name = action.name ? `[name="${escape(action.name)}"]` : ''
    return `::-p-aria([role="${escape(action.role)}"]${name})`
  }
  if (action.text) return `::-p-text(${action.text})`
  if (action.label) return `::-p-aria([name="${escape(action.label)}"])`
  if (action.placeholder) return `[placeholder="${escape(action.placeholder)}"]`
  if (action.testId) return `[data-testid="${escape(action.testId)}"]`
  if (action.alt) return `[alt="${escape(action.alt)}"]`
  throw new Error('locator: no strategy')
}

/**
 * Whether the action carries an element-locator strategy (not page-text wait mode).
 * On `wait`, `text` is page-string mode — not an element locator.
 *
 * @param {Record<string, *>} action
 * @returns {boolean}
 */
const hasElementLocator = action => {
  if (action.type === 'wait') {
    return Boolean(
      action.selector ||
        action.role ||
        action.label ||
        action.placeholder ||
        action.testId ||
        action.alt
    )
  }
  return LOCATOR_KEYS.some(key => action[key] != null)
}

module.exports = { toSelector, hasElementLocator, LOCATOR_KEYS, escape }

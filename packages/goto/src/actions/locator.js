'use strict'

const LOCATOR_KEYS = ['selector', 'role', 'text', 'label', 'placeholder', 'testId', 'alt']

const ELEMENT_LOCATOR_KEYS = LOCATOR_KEYS.filter(key => key !== 'text')

const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')

const escapeText = value =>
  String(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)')

const isSet = value => value != null && value !== ''

/**
 * Compile an action's locator fields into a Puppeteer P-selector string.
 *
 * @param {Record<string, *>} action
 * @returns {string}
 */
const toSelector = action => {
  if (isSet(action.selector)) return action.selector
  if (isSet(action.role)) {
    const name = isSet(action.name) ? `[name="${escape(action.name)}"]` : ''
    return `::-p-aria([role="${escape(action.role)}"]${name})`
  }
  if (isSet(action.text)) return `::-p-text(${escapeText(action.text)})`
  if (isSet(action.label)) return `::-p-aria([name="${escape(action.label)}"])`
  if (isSet(action.placeholder)) return `[placeholder="${escape(action.placeholder)}"]`
  if (isSet(action.testId)) return `[data-testid="${escape(action.testId)}"]`
  if (isSet(action.alt)) return `[alt="${escape(action.alt)}"]`
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
  const keys = action.type === 'wait' ? ELEMENT_LOCATOR_KEYS : LOCATOR_KEYS
  return keys.some(key => isSet(action[key]))
}

module.exports = {
  ELEMENT_LOCATOR_KEYS,
  LOCATOR_KEYS,
  escape,
  escapeText,
  hasElementLocator,
  isSet,
  toSelector
}

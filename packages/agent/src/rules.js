'use strict'

const RULE_KEYS = ['selector', 'selectorAll', 'attr', 'type']
const LOCATION_KEYS = ['selector', 'selectorAll']
const MAX_RULE_DEPTH = 4
const MAX_SELECTOR_LENGTH = 300
const MODEL_DEFAULT_ATTR = 'text'

const isPlainObject = value =>
  value !== null &&
  typeof value === 'object' &&
  [Object.prototype, null].includes(Object.getPrototypeOf(value))

const isSelector = value =>
  typeof value === 'string' && value.trim() !== '' && value.length <= MAX_SELECTOR_LENGTH

const isNested = rule => isPlainObject(rule?.attr)

const hasLocation = rule => LOCATION_KEYS.some(key => key in rule)

const invalidRule = (path, problem) => new TypeError(`Invalid rule \`${path}\`: ${problem}.`)

const assertSelectors = (rule, path) => {
  for (const key of LOCATION_KEYS) {
    if (!(key in rule)) continue
    const selectors = Array.isArray(rule[key]) ? rule[key] : [rule[key]]
    if (selectors.length === 0 || !selectors.every(isSelector)) {
      throw invalidRule(path, `${key} must be a CSS selector or a list of them`)
    }
  }
}

const assertRule = (rule, path, depth) => {
  if (!isPlainObject(rule)) throw invalidRule(path, 'a rule must be an object')
  if (depth > MAX_RULE_DEPTH) throw invalidRule(path, 'rules are nested too deeply')
  const unknown = Object.keys(rule).find(key => !RULE_KEYS.includes(key))
  if (unknown) throw invalidRule(path, `\`${unknown}\` is not supported`)
  assertSelectors(rule, path)
  if ('type' in rule && typeof rule.type !== 'string') {
    throw invalidRule(path, 'type must be a string')
  }
  if (!('attr' in rule)) return
  if (isNested(rule)) return assertRules(rule.attr, `${path}.attr`, depth + 1)
  const attrs = Array.isArray(rule.attr) ? rule.attr : [rule.attr]
  if (attrs.length === 0 || !attrs.every(attr => typeof attr === 'string' && attr !== '')) {
    throw invalidRule(path, 'attr must be an attribute name, a list of them, or nested rules')
  }
}

const assertRules = (rules, path = 'data', depth = 1) => {
  if (!isPlainObject(rules) || Object.keys(rules).length === 0) {
    throw invalidRule(path, 'rules must be an object with at least one field')
  }
  for (const [name, rule] of Object.entries(rules)) {
    const alternatives = Array.isArray(rule) ? rule : [rule]
    if (alternatives.length === 0) throw invalidRule(`${path}.${name}`, 'a rule must be an object')
    for (const alternative of alternatives) assertRule(alternative, `${path}.${name}`, depth)
  }
  return rules
}

const pick = (rule, keys) =>
  Object.fromEntries(keys.filter(key => key in rule).map(key => [key, rule[key]]))

const writtenLocation = (written, path) => {
  if (!isPlainObject(written)) throw invalidRule(path, 'the model wrote no rule for this field')
  if ('selectorAll' in written) return { selectorAll: written.selectorAll }
  if ('selector' in written) return { selector: written.selector }
  throw invalidRule(path, 'the model wrote no selector for this field')
}

const filledAttr = (field, written, path) => {
  if (isNested(field)) {
    if (!isNested(written)) {
      throw invalidRule(path, 'the model wrote no nested rules for this field')
    }
    return { attr: fillFields(field.attr, written.attr, `${path}.attr`) }
  }
  if ('attr' in field) return { attr: field.attr }
  if (isNested(written)) throw invalidRule(path, 'the model wrote nested rules for a single value')
  return isPlainObject(written) && 'attr' in written ? { attr: written.attr } : {}
}

const fillField = (field, written, path) => {
  if (Array.isArray(field)) return field.map(alternative => fillField(alternative, written, path))
  if (hasLocation(field) && !isNested(field)) return field
  const type = field.type ?? (isPlainObject(written) ? written.type : undefined)
  return {
    ...(hasLocation(field) ? pick(field, LOCATION_KEYS) : writtenLocation(written, path)),
    ...filledAttr(field, written, path),
    ...(type === undefined ? {} : { type })
  }
}

const firstAlternative = rule => (Array.isArray(rule) ? rule[0] : rule)

const fillFields = (fields, written, path = 'data') =>
  Object.fromEntries(
    Object.entries(fields).map(([name, field]) => [
      name,
      fillField(
        field,
        isPlainObject(written) ? firstAlternative(written[name]) : undefined,
        `${path}.${name}`
      )
    ])
  )

function evaluateRules (data) {
  const ATTR_PROPERTIES = { html: 'innerHTML', text: 'textContent', val: 'value' }
  const RAW_ATTRIBUTES = ['href', 'src']
  const DEFAULT_ATTRS = ['html']
  const THOUSANDS_ONLY = /^(\d{1,3})([.,])\d{3}(?:\2\d{3})*$/
  const GROUPED_WITH_DECIMALS = /^(\d{1,3}(?:([.,])\d{3})+)([.,])(\d+)$/
  const PLAIN_DECIMALS = /^(\d+)[.,](\d+)$/
  const ZERO_AND_ONE_GROUP_LENGTH = 5

  const toList = value => (Array.isArray(value) ? value : [value])
  const condense = text => text.replace(/\s+/g, ' ').trim()
  const isNested = rule =>
    rule.attr !== null && typeof rule.attr === 'object' && !Array.isArray(rule.attr)
  const isEmpty = value => value === undefined || value === null || value === ''

  const toNumber = text => {
    const token = text.replace(/−/g, '-').match(/-?\d[\d.,]*/)?.[0]
    if (!token) return undefined
    const sign = token.startsWith('-') ? -1 : 1
    const digits = token.replace(/^-/, '').replace(/[.,]+$/, '')
    if (/^\d+$/.test(digits)) return sign * Number(digits)
    const thousands = digits.match(THOUSANDS_ONLY)
    const isFractionOfZero =
      thousands && thousands[1] === '0' && digits.length === ZERO_AND_ONE_GROUP_LENGTH
    if (thousands && !isFractionOfZero) return sign * Number(digits.replace(/[.,]/g, ''))
    const grouped = digits.match(GROUPED_WITH_DECIMALS)
    if (grouped && grouped[2] !== grouped[3]) {
      return sign * Number(`${grouped[1].replace(/[.,]/g, '')}.${grouped[4]}`)
    }
    const decimals = digits.match(PLAIN_DECIMALS)
    return decimals ? sign * Number(`${decimals[1]}.${decimals[2]}`) : undefined
  }

  const toUrl = text => {
    try {
      const url = new URL(text, document.baseURI)
      return ['http:', 'https:', 'data:'].includes(url.protocol) ? url.href : undefined
    } catch {}
  }

  const toDate = text => {
    if (!/\d{4}/.test(text)) return undefined
    const date = new Date(text)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }

  const toAuto = text => {
    if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text)
    if (text === 'true' || text === 'false') return text === 'true'
    return text
  }

  const TYPES = {
    number: toNumber,
    url: toUrl,
    image: toUrl,
    date: toDate,
    string: text => text
  }

  const typed = (value, rule) => {
    if (isEmpty(value)) return undefined
    const convert = Object.hasOwn(TYPES, rule.type) ? TYPES[rule.type] : toAuto
    return convert(String(value))
  }

  const readAttr = (element, attr) => {
    if (RAW_ATTRIBUTES.includes(attr)) return element.getAttribute(attr) ?? undefined
    const property = ATTR_PROPERTIES[attr] || attr
    const value =
      typeof element[property] === 'string' ? element[property] : element.getAttribute(attr)
    if (typeof value !== 'string') return undefined
    return attr === 'text' ? condense(value) : value
  }

  const wholePage = rule =>
    toList(rule.attr || DEFAULT_ATTRS)[0] === 'text'
      ? condense(document.body.innerText)
      : document.documentElement.outerHTML

  const invalidSelectors = []

  const splitSelectorList = selector => {
    const parts = []
    let depth = 0
    let current = ''
    for (const character of selector) {
      if ('([{'.includes(character)) depth++
      if (')]}'.includes(character)) depth--
      if (character === ',' && depth === 0) {
        parts.push(current)
        current = ''
      } else current += character
    }
    return [...parts, current]
  }

  const relativeTo = selector =>
    splitSelectorList(selector)
      .map(part => `:scope ${part.trim()}`)
      .join(', ')

  const query = (scope, selector) => {
    try {
      return [...scope.querySelectorAll(scope === document ? selector : relativeTo(selector))]
    } catch {
      invalidSelectors.push(selector)
      return []
    }
  }

  const resolve = (element, rule) => {
    if (!element) return undefined
    if (!isNested(rule)) {
      const value = toList(rule.attr || DEFAULT_ATTRS)
        .map(attr => readAttr(element, attr))
        .find(found => !isEmpty(found))
      return typed(value, rule)
    }
    return Object.fromEntries(
      Object.entries(rule.attr).map(([name, nested]) => [name, select(element, nested) ?? null])
    )
  }

  const withoutRepeatedPrimitives = values => {
    const seen = new Set()
    return values.filter(value => {
      if (value !== null && typeof value === 'object') return true
      if (seen.has(value)) return false
      seen.add(value)
      return true
    })
  }

  const selectAll = (scope, selector, rule, topLevel) => {
    const values = query(scope, selector).map(element => resolve(element, rule) ?? null)
    return topLevel ? withoutRepeatedPrimitives(values.filter(value => value !== null)) : values
  }

  const select = (scope, alternatives) => {
    const topLevel = scope === document
    for (const rule of toList(alternatives)) {
      const iterable = rule.selectorAll !== undefined
      if (!iterable && rule.selector === undefined) {
        const value = topLevel ? typed(wholePage(rule), rule) : undefined
        if (!isEmpty(value)) return value
        continue
      }
      for (const selector of toList(iterable ? rule.selectorAll : rule.selector)) {
        const value = iterable
          ? selectAll(scope, selector, rule, topLevel)
          : resolve(query(scope, selector)[0], rule)
        if (Array.isArray(value) ? value.length > 0 : !isEmpty(value)) return value
      }
    }
  }

  const values = Object.fromEntries(
    Object.entries(data)
      .map(([name, alternatives]) => [name, select(document, alternatives)])
      .filter(([, value]) => value !== undefined)
  )
  return { values, invalidSelectors }
}

const applyRules = async (page, rules) => {
  const { values, invalidSelectors } = await page.evaluate(evaluateRules, assertRules(rules))
  if (invalidSelectors.length > 0) {
    throw new TypeError(`Invalid CSS selector: ${invalidSelectors[0]}`)
  }
  return values
}

const readingText = rule => {
  if (Array.isArray(rule)) return rule.map(readingText)
  if (isNested(rule)) return { ...rule, attr: readingTextByDefault(rule.attr) }
  return 'attr' in rule ? rule : { ...rule, attr: MODEL_DEFAULT_ATTR }
}

const readingTextByDefault = rules =>
  Object.fromEntries(Object.entries(rules).map(([name, rule]) => [name, readingText(rule)]))

const hasEverySelector = rule =>
  Array.isArray(rule)
    ? rule.every(hasEverySelector)
    : hasLocation(rule) && (!isNested(rule) || Object.values(rule.attr).every(hasEverySelector))

const isComplete = rules => Object.values(rules).every(hasEverySelector)

const hasData = value => {
  if (value === null || value === undefined || value === '') return false
  if (typeof value !== 'object') return true
  return Object.values(value).some(hasData)
}

module.exports = {
  applyRules,
  evaluateRules,
  assertRules,
  fillFields,
  readingTextByDefault,
  isComplete,
  hasData
}

'use strict'

const { setTimeout } = require('node:timers/promises')

const { toSelector, hasElementLocator, isSet } = require('./locator')

/**
 * Clamp a per-action timeout to the remaining request budget.
 *
 * @param {string|number|undefined} value
 * @param {number} budget
 * @returns {number}
 */
const clampTimeout = (value, budget) => {
  if (value == null || value === '') return budget
  let ms = value
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s)?$/i)
    if (!match) return budget
    ms = match[2] && match[2].toLowerCase() === 's' ? Number(match[1]) * 1000 : Number(match[1])
  }
  if (!Number.isFinite(ms) || ms < 0) return budget
  return Math.min(ms, budget)
}

const MAX_GLOB_LENGTH = 512

/**
 * Linear glob match (`*` only). A `RegExp` of `[\s\S]*` per star backtracks
 * exponentially (`*a*a*…` vs `aaa…y`) and can stall the shared event loop
 * inside `waitForResponse` before any action timeout fires.
 *
 * @param {string} pattern
 * @param {string} input
 * @returns {boolean}
 */
const globMatch = (pattern, input) => {
  const parts = pattern.split('*')
  if (parts.length === 1) return input === pattern

  let pos = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (i === 0) {
      if (part.length > 0 && !input.startsWith(part)) return false
      pos = part.length
      continue
    }
    if (i === parts.length - 1) {
      if (part.length === 0) return true
      const start = input.length - part.length
      return start >= pos && input.endsWith(part)
    }
    if (part.length === 0) continue
    const idx = input.indexOf(part, pos)
    if (idx === -1) return false
    pos = idx + part.length
  }
  return true
}

const globToRegExp = pattern => {
  const raw = String(pattern)
  if (raw.length > MAX_GLOB_LENGTH) {
    throw new Error(`wait: request pattern exceeds ${MAX_GLOB_LENGTH} characters`)
  }
  return { test: input => globMatch(raw, input) }
}

const waitForText = (page, action, timeout) =>
  page.waitForFunction(
    (text, hidden) => {
      const body = document.body ? document.body.innerText || '' : ''
      const present = body.includes(text)
      return hidden ? !present : present
    },
    { timeout },
    action.text,
    Boolean(action.hidden)
  )

const waitForResponse = async (page, action, { timeout, responseBuffer }) => {
  const pattern = globToRegExp(action.request)
  const match = res => {
    try {
      return pattern.test(res.url())
    } catch {
      return false
    }
  }

  const consume = response => {
    const index = responseBuffer.indexOf(response)
    if (index !== -1) responseBuffer.splice(index, 1)
    return response
  }

  const buffered = responseBuffer.find(match)
  if (buffered) return consume(buffered)

  return consume(await page.waitForResponse(match, { timeout }))
}

const handlers = {
  async inject (page, action, { inject, timeout }) {
    await inject(page, {
      timeout: clampTimeout(action.timeout, timeout),
      styles: action.styles,
      scripts: action.scripts,
      modules: action.modules
    })
  },

  async click (page, action, { timeout }) {
    await page.locator(toSelector(action)).setTimeout(clampTimeout(action.timeout, timeout)).click()
  },

  async wait (page, action, { timeout, responseBuffer }) {
    const budget = clampTimeout(action.timeout, timeout)

    if (hasElementLocator(action)) {
      return page.waitForSelector(toSelector(action), {
        timeout: budget,
        visible: action.visible,
        hidden: action.hidden
      })
    }
    if (isSet(action.text)) return waitForText(page, action, budget)
    if (isSet(action.request)) {
      return waitForResponse(page, action, { timeout: budget, responseBuffer })
    }
    if (isSet(action.timeout)) return setTimeout(budget)
    throw new Error('wait: no target')
  },

  async scroll (page, action, { timeout }) {
    if (hasElementLocator(action)) {
      const selector = toSelector(action)
      await page.waitForSelector(selector, { timeout: clampTimeout(action.timeout, timeout) })
      await page.$eval(selector, el => el.scrollIntoView())
      return
    }
    const x = action.x || 0
    const y = action.y || 0
    await page.evaluate((scrollX, scrollY) => window.scrollBy(scrollX, scrollY), x, y)
  },

  async fill (page, action, { timeout }) {
    await page
      .locator(toSelector(action))
      .setTimeout(clampTimeout(action.timeout, timeout))
      .fill(String(action.value ?? ''))
  },

  async evaluate (page, action) {
    await page.evaluate(action.expression)
  },

  async screenshot (page, action, { actionCaptures, index, timeout }) {
    const opts = {}
    if (action.fullPage != null) opts.fullPage = action.fullPage
    if (hasElementLocator(action)) {
      const element = await page.waitForSelector(toSelector(action), {
        timeout: clampTimeout(action.timeout, timeout)
      })
      if (element) {
        try {
          const box = await element.boundingBox()
          if (box) opts.clip = box
        } finally {
          await element.dispose()
        }
      }
    }
    const buffer = await page.screenshot(opts)
    actionCaptures.screenshots.push({ buffer, opts, index })
    return buffer
  },

  async pdf (page, action, { actionCaptures, index }) {
    const opts = {}
    if (action.format != null) opts.format = action.format
    if (action.scale != null) opts.scale = action.scale
    if (action.margin != null) opts.margin = action.margin
    if (action.printBackground != null) opts.printBackground = action.printBackground
    const buffer = await page.pdf(opts)
    actionCaptures.pdfs.push({ buffer, opts, index })
    return buffer
  }
}

module.exports = handlers
module.exports.clampTimeout = clampTimeout
module.exports.globToRegExp = globToRegExp

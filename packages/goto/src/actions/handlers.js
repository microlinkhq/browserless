'use strict'

const { setTimeout } = require('node:timers/promises')

const { toSelector, hasElementLocator } = require('./locator')

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

const globToRegExp = pattern => {
  const source = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
  return new RegExp(`^${source}$`)
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

  const buffered = responseBuffer.find(match)
  if (buffered) return buffered

  return page.waitForResponse(match, { timeout })
}

const handlers = {
  async inject (page, action, { inject, timeout }) {
    await inject(page, {
      timeout,
      styles: action.styles,
      scripts: action.scripts,
      modules: action.modules
    })
  },

  async click (page, action) {
    await page.locator(toSelector(action)).click()
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
    if (action.text != null) return waitForText(page, action, budget)
    if (action.request) return waitForResponse(page, action, { timeout: budget, responseBuffer })
    if (action.timeout != null && action.timeout !== '') {
      return setTimeout(clampTimeout(action.timeout, timeout))
    }
    throw new Error('wait: no target')
  },

  async scroll (page, action) {
    if (hasElementLocator(action) || action.selector || action.text) {
      const selector = toSelector(action)
      await page.waitForSelector(selector)
      await page.$eval(selector, el => el.scrollIntoView())
      return
    }
    const x = action.x || 0
    const y = action.y || 0
    await page.evaluate((scrollX, scrollY) => window.scrollBy(scrollX, scrollY), x, y)
  },

  async fill (page, action) {
    await page.locator(toSelector(action)).fill(String(action.value ?? ''))
  },

  async evaluate (page, action) {
    await page.evaluate(action.expression)
  },

  async screenshot (page, action, { actionCaptures, index }) {
    const opts = {}
    if (action.fullPage != null) opts.fullPage = action.fullPage
    if (hasElementLocator(action) || action.selector || action.text) {
      const selector = toSelector(action)
      await page.waitForSelector(selector)
      const element = await page.$(selector)
      const box = await element.boundingBox()
      if (box) opts.clip = box
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

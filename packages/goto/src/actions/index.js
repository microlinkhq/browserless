'use strict'

const debug = require('debug-logfmt')('browserless:goto:actions')

const { hasElementLocator, isSet } = require('./locator')
const { batchActions } = require('./batch')
const handlers = require('./handlers')

const MAX_BUFFERED_RESPONSES = 100

/**
 * The last capture in action-list order. Concurrent screenshot/pdf waves
 * `push` in completion order, so `.at(-1)` can be an earlier action.
 *
 * @param {Array<{ index?: number }>} items
 * @returns {object|undefined}
 */
const lastActionCapture = items => {
  if (!Array.isArray(items) || items.length === 0) return undefined
  return items.reduce((best, item) =>
    (item?.index ?? -1) > (best?.index ?? -1) ? item : best
  )
}

const waitMode = action => {
  if (hasElementLocator(action)) return 'element'
  if (isSet(action.text)) return 'text'
  if (isSet(action.request)) return 'request'
  if (isSet(action.timeout)) return 'timeout'
  return 'unknown'
}

/**
 * Run a flat ordered list of browser actions with internal auto-batching.
 *
 * `timeout` is the budget for the whole list: every action draws from the same
 * deadline, so the total run time never grows with the action count.
 *
 * @param {import('puppeteer').Page} page
 * @param {Array<Record<string, *>>} actions
 * @param {object} ctx
 * @param {Function} ctx.inject
 * @param {Function} ctx.run
 * @param {number} ctx.timeout
 * @returns {Promise<{ screenshots: object[], pdfs: object[] }>}
 */
const runActions = async (page, actions, { inject, run, timeout }) => {
  const actionCaptures = { screenshots: [], pdfs: [] }
  const responseBuffer = []
  const deadline = Date.now() + timeout
  const remaining = () => Math.max(0, deadline - Date.now())

  const onResponse = response => {
    if (responseBuffer.length === MAX_BUFFERED_RESPONSES) responseBuffer.shift()
    responseBuffer.push(response)
  }
  page.on('response', onResponse)

  try {
    const waves = batchActions(actions)

    for (const wave of waves) {
      const runOne = async (action, index) => {
        const handler = handlers[action.type]
        if (!handler) throw new Error(`actions[${index}]: unknown type "${action.type}"`)

        const label = action.type === 'wait' ? `wait:${waitMode(action)}` : action.type
        const budget = remaining()

        // a zero budget disables the timeout in both `run` and Puppeteer
        if (budget === 0) throw new Error(`actions[${index}] (${label}): budget exhausted`)

        const result = await run({
          fn: handler(page, action, {
            inject,
            timeout: budget,
            responseBuffer,
            actionCaptures,
            index
          }),
          timeout: budget,
          debug: { action: label, index }
        })

        if (result.isRejected) {
          const message = result.reason?.message || String(result.reason)
          const error = new Error(`actions[${index}] (${label}) failed: ${message}`)
          error.cause = result.reason
          throw error
        }

        return result.value
      }

      if (wave.actions.length === 1) {
        await runOne(wave.actions[0], wave.startIndex)
        continue
      }

      await Promise.all(
        wave.actions.map((action, offset) => runOne(action, wave.startIndex + offset))
      )
    }
  } finally {
    page.off('response', onResponse)
  }

  debug('done', {
    count: actions.length,
    screenshots: actionCaptures.screenshots.length,
    pdfs: actionCaptures.pdfs.length
  })

  return actionCaptures
}

module.exports = { runActions, batchActions, handlers, waitMode, lastActionCapture }

'use strict'

const debug = require('debug-logfmt')('browserless:goto:actions')

const { batchActions } = require('./batch')
const handlers = require('./handlers')

/**
 * Run a flat ordered list of browser actions with internal auto-batching.
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

  const onResponse = response => {
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
        const result = await run({
          fn: handler(page, action, {
            inject,
            timeout,
            responseBuffer,
            actionCaptures,
            index
          }),
          timeout,
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

const waitMode = action => {
  if (
    action.selector ||
    action.role ||
    action.label ||
    action.placeholder ||
    action.testId ||
    action.alt
  ) {
    return 'element'
  }
  if (action.text != null) return 'text'
  if (action.request) return 'request'
  if (action.timeout != null) return 'timeout'
  return 'unknown'
}

module.exports = { runActions, batchActions: require('./batch').batchActions, handlers }

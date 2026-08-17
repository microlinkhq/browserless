'use strict'

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

module.exports = { lastActionCapture }

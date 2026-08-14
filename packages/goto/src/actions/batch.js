'use strict'

/**
 * Parallel-safe batch key, or null for barrier actions.
 *
 * `pdf` is a barrier: it toggles print media emulation on the shared page.
 *
 * @param {string} type
 * @returns {'inject'|'screenshot'|null}
 */
const batchKey = type => {
  if (type === 'screenshot') return 'screenshot'
  return null
}

/**
 * Group consecutive parallel-safe actions into waves.
 *
 * @param {Array<{ type: string }>} actions
 * @returns {Array<{ key: string|null, actions: object[], startIndex: number }>}
 */
const batchActions = actions => {
  const waves = []
  let current = null

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]
    const key = batchKey(action.type)

    if (key && current && current.key === key) {
      current.actions.push(action)
      continue
    }

    if (key) {
      current = { key, actions: [action], startIndex: i }
      waves.push(current)
      continue
    }

    current = null
    waves.push({ key: null, actions: [action], startIndex: i })
  }

  return waves
}

module.exports = { batchActions, batchKey }

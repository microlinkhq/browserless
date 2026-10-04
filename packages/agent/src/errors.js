'use strict'

class BlockedError extends Error {
  constructor (reason, message, trace = []) {
    super(message)
    this.name = 'BlockedError'
    this.code = 'BLOCKED'
    this.reason = reason
    this.trace = trace
  }
}

class StaleDecisionError extends Error {
  constructor () {
    super('Target or nearby context changed; observe again before input.')
    this.name = 'StaleDecisionError'
  }
}

module.exports = { BlockedError, StaleDecisionError }

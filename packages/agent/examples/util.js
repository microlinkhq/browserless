'use strict'

const flat = ({ accuracy, cost, timing, error }) => ({
  ...accuracy,
  ...cost,
  ...timing,
  ...(error && { error: error.message })
})

const succeeded = result => {
  if (result.status === 'error') throw result.error
  return result
}

module.exports = { flat, succeeded }

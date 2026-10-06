'use strict'

const flat = ({ accuracy, cost, timing, error }) => ({
  ...accuracy,
  ...cost,
  ...timing,
  ...(error && { error: error.message })
})

module.exports = { flat }

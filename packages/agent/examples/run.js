'use strict'

const task = require('./task')

module.exports = context => {
  const { url, goal } = context.opts
  if (!url || !goal) {
    throw new TypeError('Usage: browserless exec examples/run.js --url=<url> --goal=<goal>')
  }
  return task({ name: 'run', url, goal })(context)
}

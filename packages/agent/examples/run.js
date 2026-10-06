'use strict'

const task = require('./task')

module.exports = context => {
  const { url, goal, extract } = context.opts
  if (!url || !goal || !extract) {
    throw new TypeError(
      'Usage: browserless exec examples/run.js --url=<url> --goal=<goal> --extract=<what to get>'
    )
  }
  return task({ name: 'run', url, goal, extract: { instruction: extract } })(context)
}

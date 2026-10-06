'use strict'

const { z } = require('zod')

const task = require('./task')

const extract = {
  instruction: 'say in one or two sentences what the page shows for the goal',
  schema: z.object({ answer: z.string() })
}

module.exports = context => {
  const { url, goal } = context.opts
  if (!url || !goal) {
    throw new TypeError('Usage: browserless exec examples/run.js --url=<url> --goal=<goal>')
  }
  return task({ name: 'run', url, goal, extract })(context)
}

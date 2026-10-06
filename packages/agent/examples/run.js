'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')
const { flat } = require('./util')

module.exports = async ({ page, browserless, opts }) => {
  const { url, goal, extract } = opts
  if (!url || !goal || !extract) {
    throw new TypeError(
      'Usage: browserless exec examples/run.js --url=<url> --goal=<goal> --extract=<what to get>'
    )
  }
  agent(page)

  await browserless.goto(page, { url })
  const reached = await page.goal(goal)
  if (debug.enabled) debug('goal', flat(await reached()))

  return page.extract(extract)
}

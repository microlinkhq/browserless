'use strict'

const agent = require('..')

module.exports = async ({ page, browserless, opts }) => {
  const { url, goal, extract } = opts
  if (!url || !goal || !extract) {
    throw new TypeError(
      'Usage: browserless exec examples/run.js --url=<url> --goal=<goal> --extract=<what to get>'
    )
  }
  agent(page, { decisions: 'typesafe-ai/jev' })

  await browserless.goto(page, { url })
  await page.goal(goal)

  return page.extract(extract)
}

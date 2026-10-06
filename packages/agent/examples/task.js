'use strict'

const agent = require('..')

const decisionModel = ({ jev }) => {
  if (jev === false || !process.env.TYPESAFE_API_KEY) return undefined
  const { createTypeSafeAi } = require('@ai-sdk/typesafe-ai')
  return createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel('jev-latest')
}

const summarize = ({ status, steps, decisions, trace }, page) => ({
  status,
  steps,
  decisions,
  url: page.url(),
  decisionMs: trace.map(entry => entry.decisionMs),
  operations: trace.map(entry =>
    [entry.operation, entry.action, entry.text].filter(Boolean).join(' ')
  )
})

module.exports =
  ({ name, url, goal, navigation }) =>
    async ({ page, browserless, opts }) => {
      await browserless.goto(page, { ...navigation, url: opts.url || url })
      const result = await agent(page, opts.goal || goal, {
        decisions: decisionModel(opts),
        text: opts.text
      })
      await page.screenshot({ path: `${name}.png` })
      return opts.trace ? result : summarize(result, page)
    }

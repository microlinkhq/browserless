'use strict'

const agent = require('..')

const decisionModel = ({ jev }) => {
  if (jev === false || !process.env.TYPESAFE_API_KEY) return undefined
  const { createTypeSafeAi } = require('@ai-sdk/typesafe-ai')
  return createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel('jev-latest')
}

const summarize = ({ status, steps, decisions, trace }, page, output) => ({
  status,
  steps,
  decisions,
  url: page.url(),
  output,
  decisionMs: trace.map(entry => entry.decisionMs),
  operations: trace.map(entry =>
    [entry.operation, entry.action, entry.text].filter(Boolean).join(' ')
  )
})

module.exports =
  ({ name, url, goal, extract, navigation }) =>
    async ({ page: browserPage, browserless, opts }) => {
      const page = agent(browserPage, { decisions: decisionModel(opts), text: opts.text })
      await browserless.goto(page, { ...navigation, url: opts.url || url })
      const result = await page.goal(opts.goal || goal)
      const output = await page.extract(extract.instruction, extract.schema)
      await page.screenshot({ path: `${name}.png` })
      return opts.trace ? { ...result, output } : summarize(result, page, output)
    }

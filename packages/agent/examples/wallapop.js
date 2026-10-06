'use strict'

// Live acceptance candidate. Run it with: browserless exec examples/wallapop.js
// AI_GATEWAY_API_KEY is needed for the text model. With TYPESAFE_API_KEY set, Jev makes the
// decisions (needs @ai-sdk/typesafe-ai installed); pass --no-jev to let the text model decide.
const agent = require('..')

const decisionModel = ({ jev }) => {
  if (jev === false || !process.env.TYPESAFE_API_KEY) return undefined
  const { createTypeSafeAi } = require('@ai-sdk/typesafe-ai')
  return createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel('jev-latest')
}

module.exports = async ({ page, browserless, opts }) => {
  await browserless.goto(page, { url: 'https://wallapop.com' })
  const result = await agent(page, 'busca el bmw x3 más barato', { decisions: decisionModel(opts) })
  await page.screenshot({ path: 'wallapop.png' })
  return result
}

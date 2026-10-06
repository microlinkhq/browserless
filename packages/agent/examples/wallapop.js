'use strict'

// Live acceptance candidate. Run it with: browserless exec examples/wallapop.js
// AI_GATEWAY_API_KEY covers both models. TYPESAFE_API_KEY, when set, calls Jev directly
// and needs @ai-sdk/typesafe-ai installed.
const agent = require('..')

const decisionModel = () => {
  if (!process.env.TYPESAFE_API_KEY) return undefined
  const { createTypeSafeAi } = require('@ai-sdk/typesafe-ai')
  return createTypeSafeAi({ apiKey: process.env.TYPESAFE_API_KEY }).decisionModel('jev-latest')
}

module.exports = async ({ page, browserless }) => {
  await browserless.goto(page, { url: 'https://wallapop.com' })
  const result = await agent(page, 'busca el bmw x3 más barato', { decisions: decisionModel() })
  await page.screenshot({ path: 'wallapop.png' })
  return result
}

'use strict'

// Untested live acceptance candidate. Requires decision and text-helper keys.
// Run it with: browserless exec examples/wallapop.js
const agent = require('..')

module.exports = async ({ page, browserless }) => {
  await browserless.goto(page, { url: 'https://wallapop.com' })
  const result = await agent(page, 'busca el bmw x3 más barato')
  await page.screenshot({ path: 'wallapop.png' })
  return result
}

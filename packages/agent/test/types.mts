import puppeteer from 'puppeteer'
import agent from '../src/index.js'

async function check () {
  const browser = await puppeteer.launch()
  const page = agent(await browser.newPage(), {
    decisions: 'typesafe-ai/jev',
    text: 'inception/mercury-2.5',
    reasoning: 'none',
    extractor: agent.applyRules
  })
  await page.goto('https://example.com')
  const result: agent.Result = await page.goal('find cars', { maxSteps: 60 })
  const fields: agent.Rules = { cars: { attr: { title: {}, price: { type: 'number' } } } }
  const rules: agent.Rules = await page.rules('get the cars', { fields })
  const fromRules: agent.Data = await page.extract(rules)
  const fromInstruction: agent.Data = await page.extract('get the cars', { fields, timeout: 5000 })
  const same: agent.Data = await agent.extract(page, { title: { selector: 'h1', attr: 'text' } })
  // @ts-expect-error a rule has no evaluate property
  void page.extract({ title: { selector: 'h1', evaluate: '() => 1' } })
  const reason: agent.BlockedReason = new agent.BlockedError('captcha', 'Verify').reason
  void [result, fromRules, fromInstruction, same, reason]
  await browser.close()
}
void check

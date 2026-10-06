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
  const info: agent.Info = await result({ signal: AbortSignal.timeout(5000) })
  const failure: Error | undefined = info.error
  const ids: string[] = info.cost.generationIds
  const usd: number | undefined = info.cost.usd
  // @ts-expect-error usd is undefined when a call had no gateway cost
  const strictUsd: number = info.cost.usd
  const passed: boolean | undefined = info.accuracy?.passed
  const summary: agent.Summary = result.toJSON()
  const status: 'done' = result.status
  const judged: agent.Result = await page.goal('find cars', { evaluator: 'typesafe-ai/jev' })
  const fromError: agent.InfoFunction | undefined = new agent.BlockedError('captcha', 'Verify').info
  const fields: agent.Rules = { cars: { attr: { title: {}, price: { type: 'number' } } } }
  const fromRules: agent.Data = await page.extract({ title: { selector: 'h1' } }, { timeout: 5000 })
  const fromInstruction: agent.Data = await page.extract('get the cars')
  const fromBoth: agent.Data = await page.extract('get the cars', fields, { timeout: 5000 })
  const exported: agent.Data = await agent.extract(page, 'get the cars', fields, { timeout: 5000 })
  const same: agent.Data = await agent.extract(page, { title: { selector: 'h1', attr: 'text' } })
  // @ts-expect-error a rule has no evaluate property
  void page.extract({ title: { selector: 'h1', evaluate: '() => 1' } })
  const reason: agent.BlockedReason = new agent.BlockedError('captcha', 'Verify').reason
  void [result, fromRules, fromInstruction, fromBoth, exported, same, reason, usd, passed, summary, status, judged, fromError, strictUsd, failure, ids]
  await browser.close()
}
void check

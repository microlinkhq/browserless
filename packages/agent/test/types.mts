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
  const { status, profiling } = result
  const outcome: 'success' | 'error' = status
  const steps: number = result.steps
  const trace: agent.TraceEntry[] = result.trace
  // @ts-expect-error error exists only when status is 'error'
  void result.error
  if (result.status === 'error') {
    const failure: Error = result.error
    const reason: agent.BlockedReason | undefined =
      failure instanceof agent.BlockedError ? failure.reason : undefined
    void [failure, reason]
  }
  const profile: agent.Profiling = await profiling({ signal: AbortSignal.timeout(5000) })
  const evaluationError: Error | undefined = profile.error
  const ids: string[] = profile.cost.generationIds
  const usd: number | undefined = profile.cost.usd
  // @ts-expect-error usd is undefined when a call had no gateway cost
  const strictUsd: number = profile.cost.usd
  const passed: boolean | undefined = profile.accuracy?.passed
  const judged: agent.Result = await page.goal('find cars', { evaluator: 'typesafe-ai/jev' })
  const languageDecides: agent.Result = await page.goal('find cars', { decisions: false })
  const fields: agent.Rules = { cars: { attr: { title: {}, price: { type: 'number' } } } }
  const extracted: agent.Extracted = await page.extract('get the cars', fields, { timeout: 5000 })
  // @ts-expect-error data exists only when status is 'success'
  void extracted.data
  if (extracted.status === 'success') {
    const data: agent.Data = extracted.data
    void data
  } else {
    const failure: Error = extracted.error
    void failure
  }
  const extractProfile: agent.ExtractProfiling = await extracted.profiling()
  const extractUsd: number | undefined = extractProfile.cost.usd
  const usedRules: agent.Rules | undefined = extractProfile.rules
  const fromRules: agent.Extracted = await page.extract({ title: { selector: 'h1' } }, { timeout: 5000 })
  const fromInstruction: agent.Extracted = await page.extract('get the cars')
  const exported: agent.Extracted = await agent.extract(page, 'get the cars', fields, { timeout: 5000 })
  const same: agent.Extracted = await agent.extract(page, { title: { selector: 'h1', attr: 'text' } })
  // @ts-expect-error a rule has no evaluate property
  void page.extract({ title: { selector: 'h1', evaluate: '() => 1' } })
  void [outcome, steps, trace, evaluationError, ids, usd, strictUsd, passed, judged, languageDecides]
  void [extractUsd, usedRules, fromRules, fromInstruction, exported, same]
  await browser.close()
}
void check

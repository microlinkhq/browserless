import puppeteer from 'puppeteer'
import agent from '../src/index.js'

async function check () {
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  const result: agent.Result = await agent(page, 'find cars', {
    decisions: { apiKey: 'key', baseUrl: 'https://fixture.invalid/v1', model: 'fixture' },
    maxSteps: 60
  })
  const reason: agent.BlockedReason = new agent.BlockedError('captcha', 'Verify').reason
  void reason
  void result
  await browser.close()
}
void check

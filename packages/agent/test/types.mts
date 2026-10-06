import puppeteer from 'puppeteer'
import { z } from 'zod'
import agent from '../src/index.js'

async function check () {
  const browser = await puppeteer.launch()
  const page = agent(await browser.newPage(), {
    decisions: 'typesafe-ai/jev',
    text: 'inception/mercury-2.5',
    reasoning: 'none'
  })
  await page.goto('https://example.com')
  const result: agent.Result = await page.goal('find cars', { maxSteps: 60 })
  const { cars } = await page.extract(
    'get the cars',
    z.object({ cars: z.array(z.object({ title: z.string(), price: z.number() })) })
  )
  const price: number = cars[0].price
  const same: agent.Result = await agent.goal(page, 'find cars')
  const { title } = await agent.extract(page, 'get the title', z.object({ title: z.string() }))
  // @ts-expect-error extract needs a schema
  void page.extract('get the cars')
  // @ts-expect-error output has the shape of the schema
  void cars[0].unknown
  const reason: agent.BlockedReason = new agent.BlockedError('captcha', 'Verify').reason
  void [result, price, same, title, reason]
  await browser.close()
}
void check

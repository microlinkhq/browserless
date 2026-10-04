'use strict'

// Untested live acceptance candidate. Requires decision and text-helper keys.
const puppeteer = require('puppeteer')
const agent = require('@browserless/agent')

;(async () => {
  const browser = await puppeteer.launch()
  try {
    const page = await browser.newPage()
    await page.goto('https://wallapop.com', { waitUntil: 'networkidle2' })
    await agent(page, 'busca el bmw x3 más barato')
    await page.screenshot({ path: 'wallapop.png' })
  } finally {
    await browser.close()
  }
})().catch(error => {
  console.error(error)
  process.exitCode = 1
})

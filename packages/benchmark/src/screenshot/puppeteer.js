'use strict'

const createBrowserless = require('browserless')
const puppeteer = require('puppeteer')

const main = async () => {
  const args = createBrowserless.driver.args({})
  const browser = await puppeteer.launch({ args })
  const page = await browser.newPage()
  await page.goto('https://example.com')
  await page.screenshot()
  await browser.close()
}

main().catch(() => process.exit(1))

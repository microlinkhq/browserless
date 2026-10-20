'use strict'

const createBrowser = require('browserless')
const check = require('..')

const url = process.argv[2]
if (!url) throw new Error('usage: node scripts/check.js <url>')

const main = async () => {
  const browser = createBrowser()
  const browserless = await browser.createContext()
  const page = await browserless.page()
  try {
    await browserless.goto(page, { url })
    const report = await check(page)
    console.log(JSON.stringify(report))
    if (report.bot || report.trapped.length > 0) process.exitCode = 1
  } finally {
    await browser.close()
  }
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})

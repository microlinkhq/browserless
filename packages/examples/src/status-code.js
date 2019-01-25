'use strict'

const createBrowserless = require('browserless')
const pEvent = require('p-event')

const browserless = createBrowserless()

require('./main')(async url => {
  const page = await browserless.page()
  await page.goto(url)
  const res = await pEvent(page, 'response')
  return res.status()
})

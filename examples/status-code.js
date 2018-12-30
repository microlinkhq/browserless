'use strict'

const createBrowserless = require('..')
const browserless = createBrowserless()
const pEvent = require('p-event')

require('./main')(async url => {
  const page = await browserless.page()
  await page.goto(url)
  const res = await pEvent(page, 'response')
  return res.status()
})

'use strict'

const test = require('ava')

const createBrowserless = require('browserless')

const { evasions } = require('../..')

test('washingtonpost.com', async t => {
  const browserless = createBrowserless({ evasions })

  const getDescription = browserless.evaluate(page =>
    page.evaluate(() => document.querySelector('meta[property="og:description"]').content)
  )

  const description = await getDescription(
    'https://www.washingtonpost.com/nation/2020/06/25/coronavirus-live-updates-us/'
  )

  t.snapshot(description)
})

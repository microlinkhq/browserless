'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')

const flat = ({ accuracy, cost, timing, error }) => ({
  ...accuracy,
  ...cost,
  ...timing,
  ...(error && { error: error.message })
})

module.exports = async ({ page, browserless }) => {
  agent(page, { decisions: 'typesafe-ai/jev' })

  await browserless.goto(page, { url: 'https://en.wikipedia.org/wiki/Main_Page' })
  const opened = await page.goal(
    'Search for "Gödel\'s incompleteness theorems" and open that article.'
  )
  if (debug.enabled) debug('open article', flat(await opened()))

  return page.extract('get the article title and its first paragraph', {
    title: { type: 'string' },
    firstParagraph: { type: 'string' }
  })
}

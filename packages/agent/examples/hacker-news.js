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

  await browserless.goto(page, { url: 'https://news.ycombinator.com' })
  const opened = await page.goal('Open the comments page of the first story on the front page.')
  if (debug.enabled) debug('open comments', flat(await opened()))

  return page.extract('get the story title, its points and the comments', {
    title: { type: 'string' },
    points: { type: 'number' },
    comments: { attr: { author: { type: 'string' }, text: { type: 'string' } } }
  })
}

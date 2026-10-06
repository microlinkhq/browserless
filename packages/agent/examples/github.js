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

  await browserless.goto(page, { url: 'https://github.com/microlinkhq/browserless' })
  const opened = await page.goal('Open the list of open issues of this repository.')
  if (debug.enabled) debug('open issues', flat(await opened()))

  return page.extract('get the open issues listed on the page', {
    fields: { issues: { attr: { title: { type: 'string' }, url: { type: 'url' } } } }
  })
}

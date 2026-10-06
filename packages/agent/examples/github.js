'use strict'

const agent = require('..')

module.exports = async ({ page, browserless }) => {
  agent(page, { decisions: 'typesafe-ai/jev' })

  await browserless.goto(page, { url: 'https://github.com/microlinkhq/browserless' })
  await page.goal('Open the list of open issues of this repository.')

  return page.extract('get the open issues listed on the page', {
    fields: { issues: { attr: { title: { type: 'string' }, url: { type: 'url' } } } }
  })
}

'use strict'

const agent = require('..')

module.exports = async ({ page, browserless }) => {
  agent(page, { decisions: 'typesafe-ai/jev' })

  await browserless.goto(page, { url: 'https://en.wikipedia.org/wiki/Main_Page' })
  await page.goal('Search for "Gödel\'s incompleteness theorems" and open that article.')

  return page.extract('get the article title and its first paragraph', {
    fields: { title: { type: 'string' }, firstParagraph: { type: 'string' } }
  })
}

'use strict'

const agent = require('..')

module.exports = async ({ page, browserless }) => {
  agent(page, { decisions: 'typesafe-ai/jev' })

  await browserless.goto(page, { url: 'https://news.ycombinator.com' })
  await page.goal('Open the comments page of the first story on the front page.')

  return page.extract('get the story title, its points and the comments', {
    fields: {
      title: { type: 'string' },
      points: { type: 'number' },
      comments: { attr: { author: { type: 'string' }, text: { type: 'string' } } }
    }
  })
}

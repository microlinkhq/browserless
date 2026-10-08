'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')
const { flat, succeeded } = require('./util')

module.exports = async ({ page, browserless }) => {
  agent(page)

  await browserless.goto(page, { url: 'https://news.ycombinator.com' })
  const opened = await page.goal('Open the comments page of the first story on the front page.')
  debug('open comments', { status: opened.status, ...flat(await opened.profiling()) })
  succeeded(opened)

  const { data } = succeeded(
    await page.extract('get the story title, its points and the comments', {
      title: { type: 'string' },
      points: { type: 'number' },
      comments: { attr: { author: { type: 'string' }, text: { type: 'string' } } }
    })
  )
  return data
}

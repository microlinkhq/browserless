'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')
const { flat, succeeded } = require('./util')

module.exports = async ({ page, browserless }) => {
  agent(page)

  await browserless.goto(page, { url: 'https://en.wikipedia.org/wiki/Main_Page' })
  const opened = await page.goal(
    'Search for "Gödel\'s incompleteness theorems" and open that article.'
  )
  debug('open article', { status: opened.status, ...flat(await opened.profiling()) })
  succeeded(opened)

  const { data } = succeeded(
    await page.extract('get the article title and its first paragraph', {
      title: { type: 'string' },
      firstParagraph: { type: 'string' }
    })
  )
  return data
}

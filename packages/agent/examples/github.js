'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')
const { flat, succeeded } = require('./util')

module.exports = async ({ page, browserless }) => {
  agent(page)

  await browserless.goto(page, { url: 'https://github.com/microlinkhq/browserless' })
  const opened = await page.goal('Open the list of open issues of this repository.')
  debug('open issues', { status: opened.status, ...flat(await opened.profiling()) })
  succeeded(opened)

  const { data } = succeeded(
    await page.extract('get the open issues listed on the page', {
      issues: { attr: { title: { type: 'string' }, url: { type: 'url' } } }
    })
  )
  return data
}

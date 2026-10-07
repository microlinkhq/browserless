'use strict'

const agent = require('..')
const debug = require('debug-logfmt')('browserless:agent')
const { flat, succeeded } = require('./util')

module.exports = async ({ page, browserless }) => {
  agent(page)

  await browserless.goto(page, { url: 'https://wallapop.com' })
  const searched = await page.goal('busca "bmw x3"')
  debug('search', { status: searched.status, ...flat(await searched.profiling()) })
  succeeded(searched)
  const sorted = await page.goal('ordena los resultados de más barato a más caro')
  debug('sort', { status: sorted.status, ...flat(await sorted.profiling()) })
  succeeded(sorted)

  const { data } = succeeded(
    await page.extract('get the search results', {
      products: {
        attr: { name: { type: 'string' }, price: { type: 'number' }, url: { type: 'url' } }
      }
    })
  )
  return data
}

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

  await browserless.goto(page, { url: 'https://wallapop.com' })
  const searched = await page.goal('busca "bmw x3"')
  if (debug.enabled) debug('search', flat(await searched()))
  const sorted = await page.goal('ordena los resultados de más barato a más caro')
  if (debug.enabled) debug('sort', flat(await sorted()))

  return page.extract('get the search results', {
    products: {
      attr: { name: { type: 'string' }, price: { type: 'number' }, url: { type: 'url' } }
    }
  })
}

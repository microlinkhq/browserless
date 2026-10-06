'use strict'

const agent = require('..')

module.exports = async ({ page, browserless }) => {
  agent(page, { decisions: 'typesafe-ai/jev' })

  await browserless.goto(page, { url: 'https://wallapop.com' })
  await page.goal('busca "bmw x3"')
  await page.goal('ordena los resultados de más barato a más caro')

  return page.extract('get the search results', {
    fields: {
      products: {
        attr: { name: { type: 'string' }, price: { type: 'number' }, url: { type: 'url' } }
      }
    }
  })
}

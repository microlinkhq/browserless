'use strict'

module.exports = require('./task')({
  name: 'wallapop',
  url: 'https://wallapop.com',
  goal: 'busca el bmw x3 más barato',
  extract: {
    instruction: 'get the search results',
    fields: {
      products: { attr: { name: {}, price: { type: 'number' }, url: { type: 'url' } } }
    }
  }
})

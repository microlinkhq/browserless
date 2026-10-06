'use strict'

const { z } = require('zod')

module.exports = require('./task')({
  name: 'wallapop',
  url: 'https://wallapop.com',
  goal: 'busca el bmw x3 más barato',
  extract: {
    instruction: 'get the top 5 results',
    schema: z.object({
      products: z.array(
        z.object({
          name: z.string(),
          price: z.number().describe('Price in euros'),
          url: z.string().nullable()
        })
      )
    })
  }
})

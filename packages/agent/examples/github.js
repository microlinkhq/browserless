'use strict'

const { z } = require('zod')

module.exports = require('./task')({
  name: 'github',
  url: 'https://github.com/microlinkhq/browserless',
  goal: 'Open the list of open issues of this repository.',
  extract: {
    instruction: 'get the open issues listed on the page',
    schema: z.object({ issues: z.array(z.object({ number: z.number(), title: z.string() })) })
  }
})

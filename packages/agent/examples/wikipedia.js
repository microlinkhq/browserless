'use strict'

const { z } = require('zod')

module.exports = require('./task')({
  name: 'wikipedia',
  url: 'https://en.wikipedia.org/wiki/Main_Page',
  goal: 'Find and open the Wikipedia article about Gödel’s incompleteness theorems.',
  extract: {
    instruction: 'get the article title and its first sentence',
    schema: z.object({ title: z.string(), firstSentence: z.string() })
  }
})

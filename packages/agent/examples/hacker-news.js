'use strict'

const { z } = require('zod')

module.exports = require('./task')({
  name: 'hacker-news',
  url: 'https://news.ycombinator.com',
  goal: 'Open the comments page of the first story on the front page.',
  extract: {
    instruction: 'get the story title, its points and its number of comments',
    schema: z.object({
      title: z.string(),
      points: z.number().nullable(),
      comments: z.number().nullable()
    })
  }
})

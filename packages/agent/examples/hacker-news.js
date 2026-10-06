'use strict'

module.exports = require('./task')({
  name: 'hacker-news',
  url: 'https://news.ycombinator.com',
  goal: 'Open the comments page of the first story on the front page.',
  extract: {
    instruction: 'get the story title, its points and the authors of the comments',
    fields: { title: {}, points: { type: 'number' }, commenters: {} }
  }
})

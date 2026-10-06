'use strict'

module.exports = require('./task')({
  name: 'github',
  url: 'https://github.com/microlinkhq/browserless',
  goal: 'Open the list of open issues of this repository.',
  extract: {
    instruction: 'get the open issues listed on the page',
    fields: { issues: { attr: { title: { type: 'string' }, url: { type: 'url' } } } }
  }
})

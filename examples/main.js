'use strict'

const { URL } = require('url')

module.exports = fn =>
  fn(new URL(process.argv[2]))
    .then(output => {
      if (output) console.log(output)
      process.exit()
    })
    .catch(err => {
      console.error('ERROR', err)
      process.exit(1)
    })

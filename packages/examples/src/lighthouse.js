'use strict'

const lighthouse = require('../../lighthouse')

require('./main')(async url => {
  const report = await lighthouse(url)
  return { output: report, isImage: false }
})

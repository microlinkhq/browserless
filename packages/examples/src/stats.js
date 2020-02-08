'use strict'

const stats = require('../../stats')

require('./main')(async url => {
  const metrics = await stats(url)
  console.log(JSON.stringify(metrics, null, 2))
  return metrics
})

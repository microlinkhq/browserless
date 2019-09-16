'use strict'

const createPool = require('./create')

module.exports = (opts, launchOpts) => {
  const pool = createPool(opts, launchOpts)
  ;['html', 'text', 'pdf', 'screenshot'].forEach(key => {
    pool[key] = (...args) => pool(browserless => browserless[key](...args))
  })
  return pool
}

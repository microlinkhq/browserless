'use strict'

const createPool = require('./create')

module.exports = (opts, launchOpts) => {
  const pool = createPool(opts, launchOpts)
  ;['html', 'text', 'pdf', 'screenshot'].forEach(method => {
    pool[method] = (...args) => pool(browserless => browserless[method](...args))
  })
  return pool
}

'use strict'

const createPool = require('./create')

const POOL_OPTS = {
  max: 15,
  min: 2
}

module.exports = ({ opts, ...launchOpts } = {}) => {
  const poolOpts = { ...POOL_OPTS, ...opts }
  const pool = createPool(poolOpts, launchOpts)
  ;['html', 'text', 'pdf', 'screenshot'].forEach(key => {
    pool[key] = (url, opts) => pool(browserless => browserless[key](url, opts))
  })
  return pool
}

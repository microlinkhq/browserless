'use strict'

const createPool = require('./create')

module.exports = (opts, launchOpts) => {
  const pool = createPool(opts, launchOpts)
  pool.createContext = () =>
    pool(async browserless => {
      const browser = await browserless.createContext()
      return browser
    })

  return pool
}

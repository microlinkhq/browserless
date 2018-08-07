'use strict'

const genericPool = require('generic-pool')
const createBrowserless = require('../browserless')

module.exports = (opts, launchOpts) => {
  const factory = {
    create: async () => ({
      ...(await createBrowserless(launchOpts)),
      useCount: 0
    }),
    destroy: browserless => browserless.browser.close(),
    validate: browserless => browserless.useCount < opts.maxUses
  }

  const pool = genericPool.createPool(factory, opts)
  const genericAcquire = pool.acquire.bind(pool)

  pool.acquire = async () => {
    const browserless = await genericAcquire()
    ++browserless.useCount
    return browserless
  }

  pool.use = async fn => {
    let browserless
    try {
      const browserless = await pool.acquire()
      const result = await fn(browserless)
      pool.release(browserless)
      return result
    } catch (err) {
      pool.release(browserless)
      throw err
    }
  }

  return pool
}

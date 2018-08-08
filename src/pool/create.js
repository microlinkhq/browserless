'use strict'

const genericPool = require('generic-pool')
const createBrowserless = require('../browserless')

module.exports = (opts, launchOpts) => {
  const factory = {
    create: async () => ({
      ...(await createBrowserless(launchOpts))
    }),
    destroy: browserless => browserless.browser.close()
  }

  const pool = genericPool.createPool(factory, opts)

  pool.acquire = pool.acquire.bind(pool)

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

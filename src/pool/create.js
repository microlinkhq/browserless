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

  pool.use = async fn => {
    let error
    let result
    let browserless

    try {
      browserless = await pool.acquire()
      result = await fn(browserless)
    } catch (err) {
      error = err
    }

    if (browserless) await pool.release(browserless)
    if (error) throw error
    return result
  }

  return pool
}

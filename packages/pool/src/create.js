'use strict'

const createBrowserless = require('browserless')
const genericPool = require('generic-pool')

module.exports = (opts, launchOpts) => {
  const factory = {
    create: async () => ({
      ...(await createBrowserless(launchOpts))
    }),
    destroy: browserless => browserless.browser.close()
  }

  const pool = genericPool.createPool(factory, opts)

  return async fn => {
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
}

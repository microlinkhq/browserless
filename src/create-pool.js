'use strict'

const genericPool = require('generic-pool')
const puppeteer = require('puppeteer')

const DEFAULTS = {
  max: 10,
  min: 2,
  maxUses: 50,
  testOnBorrow: true
}

module.exports = ({ launchOpts, poolOpts }) => {
  const config = Object.assign({}, DEFAULTS, poolOpts)

  const factory = {
    create: async () =>
      Object.assign(await puppeteer.launch(launchOpts), { useCount: 0 }),
    destroy: browser => browser.close(),
    validate: browser => browser.useCount < config.maxUses
  }

  const pool = genericPool.createPool(factory, config)
  const genericAcquire = pool.acquire.bind(pool)

  pool.acquire = async () => {
    const browser = await genericAcquire()
    ++browser.useCount
    return browser
  }

  pool.use = async fn => {
    let browser

    try {
      const browser = await pool.acquire()
      const result = await fn(browser)
      pool.release(browser)
      return result
    } catch (err) {
      pool.release(browser)
      throw err
    }
  }

  return pool
}

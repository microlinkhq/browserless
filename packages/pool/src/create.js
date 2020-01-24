'use strict'

const debug = require('debug-logfmt')('browserless:pool')
const createBrowserless = require('browserless')
const genericPool = require('generic-pool')
const mimicFn = require('mimic-fn')
const assert = require('assert')

const poolInfo = pool => ({
  size: pool.size,
  available: pool.available,
  borrowed: pool.borrowed,
  pending: pool.pending
})

const POOL_OPTS = {
  // should the pool start creating resources, initialize the evictor,
  // etc once the constructor is called.
  autostart: true,
  // minimum number of resources to keep in pool at any given time.
  // If this is set >= max, the pool will silently set the min to equal.
  min: 0,
  // Number of resources to check each eviction run
  testOnBorrow: true
}

module.exports = (opts, launchOpts) => {
  assert(opts.timeout, 'opts.timeout is required')
  assert(opts.max, 'opts.max is required')

  const factory = {
    create: () => {
      const browserless = createBrowserless(launchOpts)
      browserless.createdAt = Date.now()
      browserless.lifespan = () => Date.now() - browserless.createdAt
      debug('create', { createdAt: browserless.createdAt })
      return browserless
    },
    destroy: browserless => {
      debug('destroy', {
        createdAt: browserless.createdAt,
        lifespan: browserless.lifespan()
      })
      return browserless.destroy()
    },
    validate: browserless => {
      const lifespan = browserless.lifespan()
      const isValid = lifespan < opts.timeout
      debug('validate', { createdAt: browserless.createdAt, lifespan, isValid })
      return isValid
    }
  }

  const pool = genericPool.createPool(factory, { ...POOL_OPTS, ...opts })

  const decorate = fn => {
    debug('acquire browser', poolInfo(pool))
    return pool.use(fn)
  }

  return mimicFn(decorate, pool)
}

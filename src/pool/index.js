'use strict'

const createPool = require('./create')

const POOL_OPTS = {
  max: 10,
  min: 2
}

module.exports = ({ opts, ...launchOpts } = {}) => {
  const poolOpts = { ...POOL_OPTS, ...opts }
  const pool = createPool(poolOpts, launchOpts)

  return {
    pool,
    html: (url, opts) => pool.use(browserless => browserless.html(url, opts)),
    text: (url, opts) => pool.use(browserless => browserless.text(url, opts)),
    pdf: (url, opts) => pool.use(browserless => browserless.pdf(url, opts)),
    screenshot: (url, opts) =>
      pool.use(browserless => browserless.screenshot(url, opts))
  }
}

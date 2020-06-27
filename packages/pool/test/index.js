const createPool = require('../src')

const browserlessPool = createPool({ max: 2, timeout: 30000 })

require('@browserless/test')(browserlessPool, () =>
  browserlessPool.drain().then(() => browserlessPool.clear())
)

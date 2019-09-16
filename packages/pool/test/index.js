const createPool = require('../src')
require('@browserless/test')(() => createPool({ max: 2, timeout: 30000 }))

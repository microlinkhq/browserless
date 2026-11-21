'use strict'

const settlePath = require.resolve('../../src/settle')
const createSettle = require(settlePath)

const SETTLED = { settled: true, waited: 0, symptoms: [] }

const stubSettle = { wait: async () => SETTLED }

const isBrowserPage = page => typeof page.mainFrame === 'function'

const createStubSettle = page =>
  isBrowserPage(page)
    ? createSettle(page)
    : { wait: opts => stubSettle.wait(opts), stop: async () => {} }

require.cache[settlePath].exports = Object.assign(createStubSettle, createSettle)

module.exports = { stubSettle, SETTLED }

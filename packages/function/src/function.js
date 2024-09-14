'use strict'

const isolatedFunction = require('isolated-function')
const template = require('./template')

module.exports = async ({ url, code, vmOpts, browserWSEndpoint, ...opts }) => {
  const [fn, teardown] = isolatedFunction(template(code), { ...vmOpts, throwError: false })
  const result = await fn(url, browserWSEndpoint, opts)
  await teardown()
  return result
}

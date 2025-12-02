'use strict'

const isolatedFunction = require('isolated-function')
const template = require('./template')

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

module.exports = async ({ url, code, vmOpts, browserWSEndpoint, ...opts }) => {
  const needsNetwork = template.isUsingPage(code)
  const allow = needsNetwork && nodeMajor >= 25 ? ['net'] : []
  const [fn, teardown] = isolatedFunction(template(code), { ...vmOpts, allow, throwError: false })
  const result = await fn(url, browserWSEndpoint, opts)
  await teardown()
  return result
}

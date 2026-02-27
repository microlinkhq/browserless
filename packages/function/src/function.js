'use strict'

const isolatedFunction = require('isolated-function')
const template = require('./template')

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

module.exports = async ({
  url,
  code,
  vmOpts,
  browserWSEndpoint,
  needsNetwork = template.isUsingPage(code),
  ...opts
}) => {
  const permissions = needsNetwork && nodeMajor >= 25 ? ['net'] : []
  const [fn, teardown] = isolatedFunction(template(code, needsNetwork), {
    ...vmOpts,
    allow: { permissions },
    throwError: false
  })
  const result = await fn(url, browserWSEndpoint, opts)
  await teardown()
  return result
}

module.exports.isUsingPage = template.isUsingPage

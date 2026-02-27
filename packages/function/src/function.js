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
  source = template(code, needsNetwork),
  ...opts
}) => {
  const permissions = needsNetwork && nodeMajor >= 25 ? ['net'] : []
  const [fn, teardown] = isolatedFunction(source, {
    ...vmOpts,
    allow: { permissions },
    throwError: false
  })
  const result = await fn(url, browserWSEndpoint, opts)
  await teardown()
  return result
}

module.exports.isUsingPage = template.isUsingPage
module.exports.buildTemplate = template

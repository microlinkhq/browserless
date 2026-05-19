'use strict'

const template = require('./template')

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

module.exports =
  isolatedFunction =>
    async ({
      url,
      code,
      vmOpts,
      browserWSEndpoint,
      needsNetwork = template.isUsingPage(code),
      source = template(code, needsNetwork),
      ...opts
    }) => {
      const permissions = needsNetwork && nodeMajor >= 25 ? ['net'] : []
      const vmOptsAllow = vmOpts?.allow || {}
      const fn = isolatedFunction(source, {
        ...vmOpts,
        allow: {
          ...vmOptsAllow,
          permissions: [...(vmOptsAllow.permissions || []), ...permissions]
        },
        throwError: false
      })
      return fn(url, browserWSEndpoint, opts)
    }

module.exports.isUsingPage = template.isUsingPage
module.exports.buildTemplate = template

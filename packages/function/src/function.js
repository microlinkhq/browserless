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
      extendPage,
      needsNetwork = template.needsBrowser(code, extendPage),
      source = template(code, {
        usesPage: template.isUsingPage(code),
        needsBrowser: needsNetwork,
        extendPage
      }),
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
module.exports.needsBrowser = template.needsBrowser
module.exports.buildTemplate = template
module.exports.inspect = template.inspect

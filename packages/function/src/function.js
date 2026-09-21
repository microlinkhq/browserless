'use strict'

const { SLOT } = require('isolated-function')

const template = require('./template')

const [nodeMajor] = process.version.slice(1).split('.').map(Number)

/**
 * The template is built around `SLOT` rather than the user code, so every
 * function with the same page shape shares one bundled program and only the
 * slot is filled per call, instead of re-bundling the whole program.
 */
module.exports =
  isolatedFunction =>
    async ({
      url,
      code,
      vmOpts,
      browserWSEndpoint,
      extendPage,
      needsNetwork = template.needsBrowser(code, extendPage),
      source = template(SLOT, {
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
        ...(source.includes(SLOT) && { slot: code }),
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

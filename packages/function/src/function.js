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
      // `isolated-function` rejects `slot` unless the sentinel appears once.
      // A second copy means an extendPage method mentioned it; inline the user
      // code and take a full build so that call still runs.
      const copies = source.split(SLOT).length - 1
      const program =
      copies > 1
        ? template(code, {
          usesPage: template.isUsingPage(code),
          needsBrowser: needsNetwork,
          extendPage
        })
        : source
      const fn = isolatedFunction(program, {
        ...vmOpts,
        ...(copies === 1 && { slot: code }),
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
module.exports.PAGE_NOT_FOUND = template.PAGE_NOT_FOUND

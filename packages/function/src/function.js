'use strict'

const { SLOT } = require('isolated-function')
const net = require('node:net')

const template = require('./template')

// `new URL()` drops a scheme's default port, so `ws://127.0.0.1:80` has an
// empty `url.port`. The port is still in the raw authority. An endpoint that
// names no port stays ungranted.
const portOf = (endpoint, url) => {
  if (url.port !== '') return url.port
  const scheme = endpoint.indexOf('://')
  if (scheme === -1) return ''
  const authority = endpoint.slice(scheme + 3).split(/[/?#]/, 1)[0]
  const colon = authority.lastIndexOf(':')
  if (colon === -1) return ''
  const port = authority.slice(colon + 1)
  // `080` is port 80. The dial uses the number, so the grant has to as well.
  return /^\d+$/.test(port) ? String(Number(port)) : ''
}

const pair = (address, port) => {
  const value = String(port)
  return net.isIP(address) === 6 ? `[${address}]:${value}` : `${address}:${value}`
}

const egressOf = endpoint => {
  if (typeof endpoint !== 'string') return []
  let url
  try {
    url = new URL(endpoint)
  } catch {
    return []
  }
  const port = portOf(endpoint, url)
  if (port === '') return []
  const host =
    url.hostname.startsWith('[') && url.hostname.endsWith(']')
      ? url.hostname.slice(1, -1)
      : url.hostname
  if (net.isIP(host) === 0) return []
  return [{ host, port }]
}

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
      hostPage,
      needsNetwork = template.needsBrowser(code, { ...extendPage, ...hostPage }),
      source = template(SLOT, {
        usesPage: template.isUsingPage(code),
        needsBrowser: needsNetwork,
        extendPage,
        hostPage
      }),
      ...opts
    }) => {
      const permissions = needsNetwork && nodeMajor >= 25 ? ['net'] : []
      const { ssrf: policy, allow: vmOptsAllow = {}, ...vmOptsRest } = vmOpts ?? {}
      const socketHosts = egressOf(browserWSEndpoint)
      const granted = new Set(socketHosts.map(({ host, port }) => pair(host, port)))
      const ssrf =
      typeof policy === 'function'
        ? (address, port) => granted.has(pair(address, port)) || policy(address, port) === true
        : undefined
      // `isolated-function` rejects `slot` unless the sentinel appears once.
      // A second copy means an extendPage method mentioned it; inline the user
      // code and take a full build so that call still runs.
      const copies = source.split(SLOT).length - 1
      const program =
      copies > 1
        ? template(code, {
          usesPage: template.isUsingPage(code),
          needsBrowser: needsNetwork,
          extendPage,
          hostPage
        })
        : source
      const host = template.exposedHost(hostPage, extendPage)
      const fn = isolatedFunction(program, {
        ...vmOptsRest,
        ...(Array.isArray(vmOptsRest.hosts) && {
          hosts: [...vmOptsRest.hosts, ...socketHosts]
        }),
        ...(ssrf && { ssrf }),
        ...(copies === 1 && { slot: code }),
        ...(host && { host }),
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
module.exports.RESOLVE_PAGE = template.RESOLVE_PAGE

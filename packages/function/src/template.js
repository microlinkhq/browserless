'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

let cachedCode
let cachedAst
const parse = code => {
  if (code === cachedCode) return cachedAst
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })
  cachedCode = code
  cachedAst = ast
  return ast
}

const propertyName = node => {
  if (node.computed) {
    return node.property.type === 'Literal' ? node.property.value : undefined
  }
  return node.property.name
}

const isUsingName = (code, name) => {
  const ast = parse(code)
  let result = false

  walk.simple(ast, {
    ObjectPattern (node) {
      for (const prop of node.properties) {
        if (prop.type === 'Property' && prop.key.name === name) result = true
        if (prop.type === 'RestElement' && prop.argument.name === name) result = true
      }
    },
    MemberExpression (node) {
      if (node.property.name === name || node.property.value === name) result = true
    }
  })

  return result
}

const isUsingPage = code => isUsingName(code, 'page')
const isUsingResponse = code => isUsingName(code, 'response')

const analyzePageAccess = (code, stubs) => {
  const stubSet = new Set(stubs)
  const ast = parse(code)
  const pageNames = new Set(['page'])
  let beyond = false
  let stub = false

  const markAccess = name => {
    if (name == null || !stubSet.has(name)) beyond = true
    else stub = true
  }

  const isPageBinding = (node, parent) =>
    parent?.type === 'Property' &&
    parent.key.name === 'page' &&
    (parent.key === node || parent.value === node)

  walk.ancestor(ast, {
    ObjectPattern (node) {
      for (const prop of node.properties) {
        if (
          prop.type === 'Property' &&
          prop.key.name === 'page' &&
          prop.value.type === 'Identifier'
        ) {
          pageNames.add(prop.value.name)
        }
      }
    },
    RestElement (node) {
      if (node.argument.name === 'page') beyond = true
    },
    Identifier (node, ancestors) {
      if (!pageNames.has(node.name)) return
      const parent = ancestors[ancestors.length - 2]
      if (isPageBinding(node, parent)) return
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        markAccess(propertyName(parent))
        return
      }
      beyond = true
    },
    MemberExpression (node, ancestors) {
      if (propertyName(node) !== 'page') return
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'MemberExpression' && parent.object === node) {
        markAccess(propertyName(parent))
        return
      }
      beyond = true
    }
  })

  return { beyond, stub }
}

const needsBrowser = (code, extendPage, usesPage = isUsingPage(code)) => {
  if (!usesPage) return false
  if (isUsingResponse(code)) return true
  const { beyond, stub } = analyzePageAccess(code, Object.keys(extendPage || {}))
  return beyond || !stub
}

const literalName = node => {
  if (!node) return
  if (node.type === 'Identifier') return node.name
  if (node.type === 'Literal') return node.value
}

const collectKeys = (node, keys = new Set()) => {
  if (!node) return keys
  if (node.type === 'ArrayExpression') {
    for (const el of node.elements) collectKeys(el, keys)
    return keys
  }
  if (node.type !== 'ObjectExpression') return keys
  for (const prop of node.properties) {
    if (prop.type === 'SpreadElement') {
      collectKeys(prop.argument, keys)
      continue
    }
    if (prop.type !== 'Property') continue
    const name = !prop.computed || prop.key.type === 'Literal' ? literalName(prop.key) : undefined
    if (name != null) keys.add(name)
    collectKeys(prop.value, keys)
  }
  return keys
}

const isPageObject = (node, pageNames) => {
  if (node.type === 'Identifier') return pageNames.has(node.name)
  return node.type === 'MemberExpression' && propertyName(node) === 'page'
}

/**
 * Page method names and calls in `code`. Includes renamed bindings
 * (`{ page: p } => p.extract(...)`) and `obj.page.extract(...)`.
 * `keys` are nested object-literal keys on the call arguments.
 */
const inspect = code => {
  const ast = parse(code)
  const pageNames = new Set(['page'])
  const methods = new Set()
  const calls = []

  walk.ancestor(ast, {
    ObjectPattern (node) {
      for (const prop of node.properties) {
        if (
          prop.type === 'Property' &&
          prop.key.name === 'page' &&
          prop.value.type === 'Identifier'
        ) {
          pageNames.add(prop.value.name)
        }
      }
    },
    CallExpression (node) {
      const callee = node.callee
      if (callee.type !== 'MemberExpression' || !isPageObject(callee.object, pageNames)) return
      const method = propertyName(callee)
      if (method == null) return
      methods.add(method)
      const keys = new Set()
      for (const arg of node.arguments) collectKeys(arg, keys)
      calls.push({ method, keys })
    },
    MemberExpression (node, ancestors) {
      const parent = ancestors[ancestors.length - 2]
      if (parent?.type === 'CallExpression' && parent.callee === node) return
      if (!isPageObject(node.object, pageNames)) return
      const method = propertyName(node)
      if (method != null) methods.add(method)
    }
  })

  return { methods, calls }
}

const asAsyncExpr = src => (/^async\s/.test(src) ? src : `async ${src}`)

const stringifyFn = fn => {
  const src = fn.toString().trim().replace(/;$/, '')
  if (/^(?:async\s+)?function[\s*(]/.test(src)) return asAsyncExpr(src)
  if (/^(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/.test(src)) {
    if (/\bthis\b/.test(src)) {
      throw new TypeError('extendPage arrow functions cannot use `this`; use a function')
    }
    return asAsyncExpr(src)
  }
  const paren = src.indexOf('(')
  if (paren === -1) throw new TypeError('extendPage function could not be inlined')
  return asAsyncExpr(`function ${src.slice(paren)}`)
}

const applyExtendPage = (extendPage = {}) => {
  const jsonKeys = []
  const fnLines = []
  for (const [name, value] of Object.entries(extendPage)) {
    if (typeof value === 'function') {
      fnLines.push(`page[${JSON.stringify(name)}] = ${stringifyFn(value)}`)
    } else {
      jsonKeys.push(name)
    }
  }
  const lines = []
  if (jsonKeys.length) {
    lines.push(`for (const name of ${JSON.stringify(jsonKeys)}) {
        const value = pageValues[name]
        page[name] = async () => value
      }`)
  }
  lines.push(...fnLines)
  return lines.join('\n      ')
}

/**
 * Host methods the channel will expose. A value that is not a function is
 * rejected here, because a key still counts as satisfying that method and
 * would otherwise skip Chromium and fail inside the snippet. A name
 * `extendPage` also defines is left out: the eager value wins, and the host
 * method is not reachable even through the channel.
 */
const exposedHost = (hostPage, extendPage) => {
  if (!hostPage) return
  if (typeof hostPage !== 'object' || Array.isArray(hostPage)) {
    throw new TypeError('Expected `hostPage` to be an object of functions')
  }
  const covered = new Set(Object.keys(extendPage || {}))
  const host = {}
  for (const [name, value] of Object.entries(hostPage)) {
    if (typeof value !== 'function') {
      throw new TypeError(`Expected hostPage.${name} to be a function`)
    }
    // Assignment through this name sets [[Prototype]] instead of an own method.
    if (name === '__proto__') {
      throw new TypeError('Expected hostPage.__proto__ not to be a method name')
    }
    if (!covered.has(name)) host[name] = value
  }
  return Object.keys(host).length ? host : undefined
}

/**
 * A host method is not serialized into the isolate at all: the call travels
 * over the channel when the snippet makes it, so a method the snippet never
 * reaches is never resolved.
 */
const applyHostPage = (hostPage, extendPage) =>
  Object.keys(exposedHost(hostPage, extendPage) || {})
    .map(
      name =>
        `page[${JSON.stringify(name)}] = (...args) => globalThis.__isolated_host(${JSON.stringify(
          name
        )}, args)`
    )
    .join('\n      ')

// _response is a plain JSON object serialized via isolated-function;
// wrap each value as a method to match Puppeteer's HTTPResponse API
const withResponse = `
  const { _response: _r, pageValues, targetId: _t, strictTarget: _s, ...rest } = opts
  const response = _r
    ? Object.fromEntries(Object.entries(_r).map(([k, v]) => [k, () => v]))
    : undefined`

const normalizeOpts = (code, usesPageOrOpts) => {
  if (usesPageOrOpts && typeof usesPageOrOpts === 'object') {
    const extendPage = usesPageOrOpts.extendPage || {}
    const hostPage = usesPageOrOpts.hostPage || {}
    const usesPage = usesPageOrOpts.usesPage ?? isUsingPage(code)
    return {
      usesPage,
      needsBrowser:
        usesPageOrOpts.needsBrowser ?? needsBrowser(code, { ...extendPage, ...hostPage }, usesPage),
      extendPage,
      hostPage
    }
  }
  const usesPage = usesPageOrOpts ?? isUsingPage(code)
  return { usesPage, needsBrowser: usesPage, extendPage: {}, hostPage: {} }
}

/**
 * Reaching the page is the runner's work, not the snippet's, so it lands in
 * `run` with no way to tell the parts apart. Naming the spans needs
 * `isolated-function` 0.2.12, which also takes them back out of `run` so the
 * phases add up; an older one simply reports nothing.
 */
const TIMED_SPAN = `
      const timed = globalThis.__isolated_time ?? ((name, thunk) => thunk())`

const PAGE_NOT_FOUND = 'Could not resolve the supplied page'

// Runs inside the isolate. A page supplied by the caller outlives this call, so
// a session left attached by a failed lookup accumulates on someone else's page:
// detach in `finally`, not after the comparison.
const RESOLVE_PAGE = `
        const knownTargetId = candidate => {
          try {
            return candidate.target()._targetId ?? candidate.mainFrame()._id
          } catch {
            return undefined
          }
        }
        const askTargetId = async candidate => {
          let session
          try {
            session = await candidate.createCDPSession()
            const { targetInfo } = await session.send('Target.getTargetInfo')
            return targetInfo.targetId
          } catch {
            return undefined
          } finally {
            if (session) { try { await session.detach() } catch {} }
          }
        }
        const resolvePage = async (pages, targetId) => {
          for (const candidate of pages) {
            if (knownTargetId(candidate) === targetId) return candidate
          }
          for (const candidate of pages) {
            if (await askTargetId(candidate) === targetId) return candidate
          }
        }`

const template = (code, usesPageOrOpts) => {
  const {
    usesPage,
    needsBrowser: withBrowser,
    extendPage,
    hostPage
  } = normalizeOpts(code, usesPageOrOpts)
  const extensions = [applyHostPage(hostPage, extendPage), applyExtendPage(extendPage)]
    .filter(Boolean)
    .join('\n      ')

  if (!usesPage) {
    return `async (url, _, opts) => {
    ${withResponse}
    return (${code})({ response, ...rest, url })
  }`
  }

  if (!withBrowser) {
    return `async (url, _, opts) => {
    ${withResponse}
    const page = {}
    ${extensions}
    return (${code})({ page, response, ...rest, url })
  }`
  }

  return `
    async (url, browserWSEndpoint, opts) => {
      ${withResponse}
      ${TIMED_SPAN}
      const puppeteer = require('@cloudflare/puppeteer')
      const browser = await timed('connect', () => puppeteer.connect({ browserWSEndpoint }))
      ${RESOLVE_PAGE}
      try {
        const pages = await timed('pages', () => browser.pages())
        const { targetId, strictTarget } = opts
        let page
        if (targetId && (strictTarget || pages.length > 1)) {
          page = await timed('resolve', () => resolvePage(pages, targetId))
        }
        if (!page) {
          if (strictTarget) throw new Error(${JSON.stringify(PAGE_NOT_FOUND)})
          page = pages[pages.length - 1]
        }
        ${extensions}
        return await (${code})({ page, response, ...rest, url })
      } finally {
        await browser.disconnect()
      }
    }`
}

module.exports = template
module.exports.isUsingPage = isUsingPage
module.exports.needsBrowser = needsBrowser
module.exports.exposedHost = exposedHost
module.exports.inspect = inspect
module.exports.PAGE_NOT_FOUND = PAGE_NOT_FOUND
module.exports.RESOLVE_PAGE = RESOLVE_PAGE
module.exports.TIMED_SPAN = TIMED_SPAN

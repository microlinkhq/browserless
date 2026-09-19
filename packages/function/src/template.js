'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const parse = code => acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })

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
      node.properties.forEach(prop => {
        if (prop.type === 'Property' && prop.key.name === name) result = true
        if (prop.type === 'RestElement' && prop.argument.name === name) result = true
      })
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

const usesPageBeyond = (code, stubs) => analyzePageAccess(code, stubs).beyond

const stubNames = (extendPage = {}) => Object.keys(extendPage)

const needsBrowser = (code, extendPage, usesPage = isUsingPage(code)) => {
  if (!usesPage) return false
  if (isUsingResponse(code)) return true
  const { beyond, stub } = analyzePageAccess(code, stubNames(extendPage))
  return beyond || !stub
}

const asAsyncExpr = src => (/^(?:async\s)/.test(src) ? src : `async ${src}`)

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
  const lines = []
  const jsonKeys = []
  for (const [name, value] of Object.entries(extendPage)) {
    if (typeof value === 'function') {
      lines.push(`page[${JSON.stringify(name)}] = ${stringifyFn(value)}`)
    } else {
      jsonKeys.push(name)
    }
  }
  if (jsonKeys.length) {
    lines.unshift(`for (const name of ${JSON.stringify(jsonKeys)}) {
        const value = _extendPage[name]
        page[name] = async () => value
      }`)
  }
  return lines.join('\n      ')
}

// _response is a plain JSON object serialized via isolated-function;
// wrap each value as a method to match Puppeteer's HTTPResponse API
const withResponse = `
  const { _response: _r, _extendPage, ...rest } = opts
  const response = _r
    ? Object.fromEntries(Object.entries(_r).map(([k, v]) => [k, () => v]))
    : undefined`

const normalizeOpts = (code, usesPageOrOpts) => {
  if (usesPageOrOpts && typeof usesPageOrOpts === 'object') {
    const extendPage = usesPageOrOpts.extendPage || {}
    const usesPage = usesPageOrOpts.usesPage ?? isUsingPage(code)
    return {
      usesPage,
      needsBrowser: usesPageOrOpts.needsBrowser ?? needsBrowser(code, extendPage, usesPage),
      extendPage
    }
  }
  const usesPage = usesPageOrOpts ?? isUsingPage(code)
  return { usesPage, needsBrowser: usesPage, extendPage: {} }
}

const template = (code, usesPageOrOpts) => {
  const { usesPage, needsBrowser: withBrowser, extendPage } = normalizeOpts(code, usesPageOrOpts)
  const extensions = applyExtendPage(extendPage)

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
    return (${code})({ page, response, ...rest })
  }`
  }

  return `
    async (url, browserWSEndpoint, opts) => {
      ${withResponse}
      const puppeteer = require('@cloudflare/puppeteer')
      const browser = await puppeteer.connect({ browserWSEndpoint })
      const pages = await browser.pages()
      const { targetId } = opts
      let page
      if (targetId && pages.length > 1) {
        for (const p of pages) {
          try {
            const session = await p.createCDPSession()
            const { targetInfo } = await session.send('Target.getTargetInfo')
            await session.detach()
            if (targetInfo.targetId === targetId) { page = p; break }
          } catch {}
        }
      }
      if (!page) page = pages[pages.length - 1]
      ${extensions}
      try {
        return await (${code})({ page, response, ...rest, url })
      } finally {
        await browser.disconnect()
      }
    }`
}

module.exports = template
module.exports.isUsingPage = isUsingPage
module.exports.needsBrowser = needsBrowser
module.exports.usesPageBeyond = usesPageBeyond

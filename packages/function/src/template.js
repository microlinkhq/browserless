'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

const isUsingPage = code => {
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })

  let result = false

  walk.simple(ast, {
    ObjectPattern (node) {
      node.properties.forEach(prop => {
        if (prop.type === 'Property' && prop.key.name === 'page') {
          result = true
        }
        if (prop.type === 'RestElement' && prop.argument.name === 'page') {
          result = true
        }
      })
    },
    MemberExpression (node) {
      if (node.property.name === 'page' || node.property.value === 'page') {
        result = true
      }
    }
  })

  return result
}

// _response is a plain JSON object serialized via isolated-function;
// wrap each value as a method to match Puppeteer's HTTPResponse API
const withResponse = `
  const { _response: _r, ...rest } = opts
  const response = _r
    ? Object.fromEntries(Object.entries(_r).map(([k, v]) => [k, () => v]))
    : undefined`

const template = (code, usesPage = isUsingPage(code)) => {
  if (!usesPage) {
    return `async (url, _, opts) => {
    ${withResponse}
    return (${code})({ response, ...rest })
  }`
  }
  return `
    async (url, browserWSEndpoint, opts) => {
      ${withResponse}
      const puppeteer = require('@cloudflare/puppeteer')
      const browser = await puppeteer.connect({ browserWSEndpoint })
      const pages = await browser.pages()
      const page = pages[pages.length - 1]
      try {
        return await (${code})({ page, response, ...rest })
      } finally {
        await browser.disconnect()
      }
    }`
}

module.exports = template
module.exports.isUsingPage = isUsingPage

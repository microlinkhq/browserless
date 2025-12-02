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

const template = code => {
  if (!isUsingPage(code)) return `async (url, _, opts) => (${code})(opts)`
  return `
    async (url, browserWSEndpoint, opts) => {
      const puppeteer = require('@cloudflare/puppeteer')
      const browser = await puppeteer.connect({ browserWSEndpoint })
      const pages = await browser.pages()
      const page = pages[pages.length - 1]
      try {
        return await (${code})({ page, ...opts })
      } finally {
        await browser.disconnect()
      }
    }`
}

module.exports = template
module.exports.isUsingPage = isUsingPage

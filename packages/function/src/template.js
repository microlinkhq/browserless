'use strict'

const walk = require('acorn-walk')
const acorn = require('acorn')

module.exports = code => {
  const ast = acorn.parse(code, { ecmaVersion: 2023, sourceType: 'module' })

  let isUsingPage = false

  walk.simple(ast, {
    ObjectPattern (node) {
      node.properties.forEach(prop => {
        if (prop.type === 'Property' && prop.key.name === 'page') {
          isUsingPage = true
        }
        if (prop.type === 'RestElement' && prop.argument.name === 'page') {
          isUsingPage = true
        }
      })
    },
    MemberExpression (node) {
      if (node.property.name === 'page' || node.property.value === 'page') {
        isUsingPage = true
      }
    }
  })

  if (!isUsingPage) return `async (url, _, opts) => (${code})(opts)`
  return `
    async (url, browserWSEndpoint, opts) => {
      const puppeteer = require('@cloudflare/puppeteer')
      const browser = await puppeteer.connect({ browserWSEndpoint })
      const page = (await browser.pages())[1]
      try {
        return await (${code})({ page, ...opts })
      } finally {
        await browser.disconnect()
      }
    }`
}

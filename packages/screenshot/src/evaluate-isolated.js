'use strict'

const isolatedRealm = page =>
  typeof page.mainFrame === 'function' ? page.mainFrame().isolatedRealm() : page

const evaluateIsolated = (page, pageFunction, ...args) =>
  isolatedRealm(page).evaluate(pageFunction, ...args)

module.exports = { evaluateIsolated }

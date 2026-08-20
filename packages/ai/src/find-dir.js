'use strict'

const path = require('node:path')
const { existsSync, readdirSync, statSync } = require('node:fs')

const findDir = (root, predicate) => {
  if (!existsSync(root)) return
  if (predicate(root)) return root
  if (!statSync(root).isDirectory()) return
  for (const name of readdirSync(root)) {
    if (name === '_metadata') continue
    const next = path.join(root, name)
    if (statSync(next).isDirectory()) {
      const found = findDir(next, predicate)
      if (found) return found
    }
  }
}

const hasFile = (root, file) => findDir(root, current => existsSync(path.join(current, file)))

module.exports = { findDir, hasFile }

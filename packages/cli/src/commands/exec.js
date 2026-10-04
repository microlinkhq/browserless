'use strict'

const { pathToFileURL } = require('url')
const path = require('path')
const fs = require('fs')

const loadScript = async file => {
  if (!file) throw new TypeError('exec requires a script file: browserless exec <file>')
  const filepath = path.resolve(file)
  if (!fs.existsSync(filepath)) throw new TypeError(`Script file not found: ${filepath}`)
  const { default: script } = await import(pathToFileURL(filepath))
  const run = typeof script === 'function' ? script : script?.default
  if (typeof run !== 'function') throw new TypeError(`${file} must export a function.`)
  return run
}

const serialize = result => {
  if (result === undefined) return ''
  if (typeof result === 'string' || Buffer.isBuffer(result)) return result
  return JSON.stringify(result, null, 2)
}

module.exports = async ({ input: file, browserless, opts }) => {
  const run = await loadScript(file)
  const page = await browserless.page()
  return [serialize(await run({ page, browserless, opts }))]
}

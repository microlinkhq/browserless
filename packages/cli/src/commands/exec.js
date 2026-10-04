'use strict'

const { pathToFileURL } = require('url')
const path = require('path')
const fs = require('fs')

const resolveFile = file => {
  if (!file) throw new TypeError('exec requires a script file: browserless exec <file>')
  const filepath = path.resolve(file)
  if (!fs.existsSync(filepath)) throw new TypeError(`Script file not found: ${filepath}`)
  return filepath
}

const loadScript = async filepath => {
  const { default: script } = await import(pathToFileURL(filepath))
  const run = typeof script === 'function' ? script : script?.default
  if (typeof run !== 'function') throw new TypeError(`${filepath} must export a function.`)
  return run
}

const toBuffer = view => Buffer.from(view.buffer, view.byteOffset, view.byteLength)

const serialize = result => {
  if (result === undefined) return ''
  if (typeof result === 'string') return result
  if (ArrayBuffer.isView(result)) return toBuffer(result)
  return JSON.stringify(result, null, 2)
}

module.exports = async ({ file, browserless, opts }) => {
  const run = await loadScript(file)
  const page = await browserless.page()
  return [serialize(await run({ page, browserless, opts }))]
}

module.exports.resolveFile = resolveFile

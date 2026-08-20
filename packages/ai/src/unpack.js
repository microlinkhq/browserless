'use strict'

const { pipeline } = require('node:stream/promises')
const { spawnSync } = require('node:child_process')
const { createInflateRaw } = require('node:zlib')
const { open } = require('node:fs/promises')
const { Readable } = require('node:stream')
const path = require('node:path')
const os = require('node:os')

const {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  unlinkSync,
  writeFileSync
} = require('node:fs')

const { hasFile } = require('./find-dir')

const cacheRoot = () =>
  process.env.XDG_CACHE_HOME
    ? path.join(process.env.XDG_CACHE_HOME, 'browserless-ai')
    : path.join(os.homedir(), '.cache', 'browserless-ai')

const installed = dir => {
  if (!hasFile(dir, 'weights.bin')) return
  const hasAdaptation =
    ['prompt', 'summarize', 'detect'].some(name =>
      hasFile(path.join(dir, name), 'model-info.pb')
    ) || hasFile(dir, 'model-info.pb')
  if (!hasAdaptation) return
  return { dir }
}

const writeZip = async (input, dest) => {
  if (input == null) {
    if (!existsSync(dest)) throw new Error('download did not write a zip')
    return dest
  }
  if (typeof input === 'string') return path.resolve(input)
  mkdirSync(path.dirname(dest), { recursive: true })
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    writeFileSync(dest, input)
    return dest
  }
  const body = input.body || input.Body || input
  const stream = typeof body.getReader === 'function' ? Readable.fromWeb(body) : body
  await pipeline(stream, createWriteStream(dest))
  return dest
}

const safeDest = (dir, name) => {
  if (name.endsWith('/')) return
  const dest = path.join(dir, name)
  const rel = path.relative(dir, dest)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`refusing to extract ${name}`)
  }
  return dest
}

const unzipJs = async (zipPath, dir) => {
  const fd = await open(zipPath, 'r')
  try {
    let pos = 0
    const read = async (length, at = pos) => {
      const buf = Buffer.alloc(length)
      const { bytesRead } = await fd.read(buf, 0, length, at)
      return buf.subarray(0, bytesRead)
    }

    while (true) {
      const sig = await read(4, pos)
      if (sig.length < 4 || sig.readUInt32LE(0) !== 0x04034b50) break
      const rest = await read(26, pos + 4)
      const method = rest.readUInt16LE(4)
      const compressed = rest.readUInt32LE(14)
      const nameLen = rest.readUInt16LE(22)
      const extraLen = rest.readUInt16LE(24)
      const name = (await read(nameLen, pos + 30)).toString()
      const dataStart = pos + 30 + nameLen + extraLen
      const dest = safeDest(dir, name)
      pos = dataStart + compressed
      if (!dest) continue
      if (method !== 0 && method !== 8) {
        throw new Error(`unsupported zip method ${method} (${name})`)
      }
      mkdirSync(path.dirname(dest), { recursive: true })
      process.stderr.write(`extracting ${name}\n`)
      if (compressed === 0) {
        writeFileSync(dest, '')
        continue
      }
      const source = createReadStream(zipPath, {
        start: dataStart,
        end: dataStart + compressed - 1
      })
      const destStream = createWriteStream(dest)
      if (method === 8) await pipeline(source, createInflateRaw(), destStream)
      else await pipeline(source, destStream)
    }
  } finally {
    await fd.close()
  }
}

const unzip = async (zipPath, dir) => {
  mkdirSync(dir, { recursive: true })
  const probe = spawnSync('unzip', ['-tqq', zipPath], { stdio: 'ignore' })
  if (probe.status === 0) {
    const result = spawnSync('unzip', ['-o', zipPath, '-d', dir], { stdio: 'inherit' })
    if (result.status !== 0) throw new Error('unzip failed')
    return
  }
  await unzipJs(zipPath, dir)
}

const unpack = async (get, { dir, force = false } = {}) => {
  if (get == null) throw new Error('unpack requires a zip path or download function')
  dir = dir || process.env.BROWSERLESS_AI_DIR || cacheRoot()
  mkdirSync(dir, { recursive: true })

  const already = installed(dir)
  if (already && !force) return already

  const dest = path.join(dir, 'bundle.zip')
  const zipPath =
    typeof get === 'function' ? await writeZip(await get(dest), dest) : path.resolve(get)
  if (!existsSync(zipPath)) throw new Error(`missing zip: ${zipPath}`)

  await unzip(zipPath, dir)
  const paths = installed(dir)
  if (!paths) throw new Error('bundle did not contain nano weights and an adaptation')
  if (zipPath === dest) unlinkSync(dest)
  return paths
}

module.exports = unpack

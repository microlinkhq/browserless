'use strict'

const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, existsSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('ava')

const createAi = require('..')

const writeStoreZip = (zipPath, files) => {
  const chunks = []
  for (const [name, data] of files) {
    const nameBuf = Buffer.from(name)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    chunks.push(local, nameBuf, data)
  }
  writeFileSync(zipPath, Buffer.concat(chunks))
}

const tmp = label => mkdtempSync(path.join(tmpdir(), `browserless-ai-${label}-`))

const fixture = label => {
  const root = tmp(label)
  const zipPath = path.join(root, 'bundle.zip')
  const dir = path.join(root, 'out')
  writeStoreZip(zipPath, [
    ['nano/weights.bin', Buffer.from('weights')],
    ['detect/model-info.pb', Buffer.from('detect')]
  ])
  return { zipPath, dir }
}

test('unpack is exported', t => {
  t.true(typeof createAi.unpack === 'function')
})

test('unpack requires a source', async t => {
  await t.throwsAsync(createAi.unpack(), { message: /zip path or download/ })
})

test('unpack extracts weights and adaptations', async t => {
  const { zipPath, dir } = fixture('unpack')
  const { dir: unpacked } = await createAi.unpack(zipPath, { dir })
  t.is(unpacked, dir)
  t.true(existsSync(path.join(dir, 'nano', 'weights.bin')))
  t.true(existsSync(path.join(dir, 'detect', 'model-info.pb')))
})

test('unpack accepts a download function', async t => {
  const { zipPath, dir } = fixture('download-fn')
  const { dir: unpacked } = await createAi.unpack(() => zipPath, { dir })
  t.is(unpacked, dir)
  t.true(existsSync(path.join(dir, 'nano', 'weights.bin')))
})

test('unpack passes dest to the download function', async t => {
  const { zipPath, dir } = fixture('download-dest')
  const { dir: unpacked } = await createAi.unpack(dest => copyFileSync(zipPath, dest), { dir })
  t.is(unpacked, dir)
  t.true(existsSync(path.join(dir, 'nano', 'weights.bin')))
  t.false(existsSync(path.join(dir, 'bundle.zip')))
})

test('unpack skips download when already installed', async t => {
  const dir = tmp('installed')
  mkdirSync(path.join(dir, 'nano'), { recursive: true })
  mkdirSync(path.join(dir, 'detect'), { recursive: true })
  writeFileSync(path.join(dir, 'nano', 'weights.bin'), 'weights')
  writeFileSync(path.join(dir, 'detect', 'model-info.pb'), 'detect')

  const { dir: unpacked } = await createAi.unpack('/missing.zip', { dir })
  t.is(unpacked, dir)
})

test('unpack force re-extracts over an installed tree', async t => {
  const { zipPath, dir } = fixture('force')
  mkdirSync(path.join(dir, 'nano'), { recursive: true })
  mkdirSync(path.join(dir, 'detect'), { recursive: true })
  writeFileSync(path.join(dir, 'nano', 'weights.bin'), 'old')
  writeFileSync(path.join(dir, 'detect', 'model-info.pb'), 'old')
  writeFileSync(path.join(dir, 'stale.txt'), 'x')

  await createAi.unpack(zipPath, { dir, force: true })
  t.is(require('node:fs').readFileSync(path.join(dir, 'nano', 'weights.bin'), 'utf8'), 'weights')
  t.false(existsSync(path.join(dir, 'stale.txt')))
})

test('unpack throws when the zip is missing', async t => {
  const dir = tmp('missing')
  await t.throwsAsync(createAi.unpack(path.join(dir, 'nope.zip'), { dir }), {
    message: /missing zip/
  })
})

test('unpack accepts a buffer', async t => {
  const { zipPath, dir } = fixture('buffer')
  const buf = require('node:fs').readFileSync(zipPath)
  const { dir: unpacked } = await createAi.unpack(() => buf, { dir })
  t.is(unpacked, dir)
  t.true(existsSync(path.join(dir, 'nano', 'weights.bin')))
})

test('unpack does not write zip-slip paths outside dest', async t => {
  const root = tmp('slip')
  const zipPath = path.join(root, 'bundle.zip')
  const dir = path.join(root, 'out')
  writeStoreZip(zipPath, [['../evil.bin', Buffer.from('nope')]])
  await t.throwsAsync(createAi.unpack(zipPath, { dir }))
  t.false(existsSync(path.join(root, 'evil.bin')))
})

test('unpack rejects zip entries with a data descriptor', async t => {
  const root = tmp('descriptor')
  const zipPath = path.join(root, 'bundle.zip')
  const dir = path.join(root, 'out')
  const nameBuf = Buffer.from('nano/weights.bin')
  const local = Buffer.alloc(30)
  local.writeUInt32LE(0x04034b50, 0)
  local.writeUInt16LE(0x08, 6)
  local.writeUInt16LE(nameBuf.length, 26)
  writeFileSync(zipPath, Buffer.concat([local, nameBuf]))
  await t.throwsAsync(createAi.unpack(zipPath, { dir }), { message: /data descriptor/ })
})

test('unpack rejects a bundle without an adaptation', async t => {
  const root = tmp('no-adapt')
  const zipPath = path.join(root, 'bundle.zip')
  const dir = path.join(root, 'out')
  writeStoreZip(zipPath, [['nano/weights.bin', Buffer.from('weights')]])
  await t.throwsAsync(createAi.unpack(zipPath, { dir }), { message: /adaptation/ })
})

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

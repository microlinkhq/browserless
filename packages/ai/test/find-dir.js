'use strict'

const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('ava')

const { cacheRoot, findDir, hasFile } = require('../src/find-dir')

const tmp = () => mkdtempSync(path.join(tmpdir(), 'browserless-ai-find-'))

test('hasFile finds a nested file and skips _metadata', t => {
  const root = tmp()
  mkdirSync(path.join(root, '_metadata'), { recursive: true })
  writeFileSync(path.join(root, '_metadata', 'weights.bin'), 'nope')
  mkdirSync(path.join(root, 'nano'), { recursive: true })
  writeFileSync(path.join(root, 'nano', 'weights.bin'), 'yes')
  t.is(hasFile(root, 'weights.bin'), path.join(root, 'nano'))
})

test('cacheRoot uses XDG_CACHE_HOME when set', t => {
  const prev = process.env.XDG_CACHE_HOME
  process.env.XDG_CACHE_HOME = path.join(tmp(), 'xdg')
  t.is(cacheRoot(), path.join(process.env.XDG_CACHE_HOME, 'browserless-ai'))
  if (prev === undefined) delete process.env.XDG_CACHE_HOME
  else process.env.XDG_CACHE_HOME = prev
})

test('findDir returns undefined when the root is missing', t => {
  t.is(
    findDir(path.join(tmp(), 'missing'), () => true),
    undefined
  )
})

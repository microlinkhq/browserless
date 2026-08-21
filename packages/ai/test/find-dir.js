'use strict'

const { mkdtempSync, mkdirSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const test = require('ava')

const { hasFile, findDir } = require('../src/find-dir')

const tmp = () => mkdtempSync(path.join(tmpdir(), 'browserless-ai-find-'))

test('hasFile finds a nested file and skips _metadata', t => {
  const root = tmp()
  mkdirSync(path.join(root, '_metadata'), { recursive: true })
  writeFileSync(path.join(root, '_metadata', 'weights.bin'), 'nope')
  mkdirSync(path.join(root, 'nano'), { recursive: true })
  writeFileSync(path.join(root, 'nano', 'weights.bin'), 'yes')
  t.is(hasFile(root, 'weights.bin'), path.join(root, 'nano'))
})

test('findDir returns undefined when the root is missing', t => {
  t.is(
    findDir(path.join(tmp(), 'missing'), () => true),
    undefined
  )
})

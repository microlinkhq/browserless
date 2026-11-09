'use strict'

const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, unlinkSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { default: test } = require('ava')

const { baseSource } = require('../src/perf')

const BASE_CONTENT = 'module.exports = () => 1\n'
const TRACKED_FILE = 'packages/demo/src/index.js'

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' })

const createRepo = () => {
  const root = mkdtempSync(path.join(tmpdir(), 'perf-base-'))
  git(root, 'init', '--quiet')
  mkdirSync(path.join(root, 'packages/demo/src'), { recursive: true })
  writeFileSync(path.join(root, TRACKED_FILE), BASE_CONTENT)
  git(root, 'add', '.')
  git(root, '-c', 'user.name=test', '-c', 'user.email=test@test', 'commit', '--quiet', '-m', 'base')
  return root
}

const withRepo = fn => () => {
  const previousCwd = process.cwd()
  const previousBase = process.env.PERF_BASE
  const root = createRepo()
  process.env.PERF_BASE = 'HEAD'
  process.chdir(path.join(root, 'packages/demo'))
  try {
    return fn(root)
  } finally {
    process.chdir(previousCwd)
    if (previousBase === undefined) delete process.env.PERF_BASE
    else process.env.PERF_BASE = previousBase
  }
}

test('skips a file the pull request did not change', t => {
  withRepo(() => t.is(baseSource(TRACKED_FILE), null))()
})

test('returns the base source of a file the pull request changed', t => {
  withRepo(root => {
    writeFileSync(path.join(root, TRACKED_FILE), 'module.exports = () => 2\n')
    t.is(baseSource(TRACKED_FILE), BASE_CONTENT)
  })()
})

test('returns the base source of a file the pull request deleted', t => {
  withRepo(root => {
    unlinkSync(path.join(root, TRACKED_FILE))
    t.is(baseSource(TRACKED_FILE), BASE_CONTENT)
  })()
})

test('throws when an explicit base is missing the file', t => {
  withRepo(() => t.throws(() => baseSource('packages/demo/src/missing.js')))()
})

test('skips without an explicit base when the default base is unavailable', t => {
  withRepo(() => {
    delete process.env.PERF_BASE
    t.is(baseSource(TRACKED_FILE), null)
  })()
})

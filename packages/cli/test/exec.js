'use strict'

const { execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const test = require('ava')

const exec = require('../src/commands/exec')

const CLI = path.resolve(__dirname, '../src/index.js')
const fixture = name => path.resolve(__dirname, 'fixtures', name)

const runCli = args =>
  promisify(execFile)(process.execPath, [CLI, ...args, '--no-verbose']).then(
    ({ stdout, stderr }) => ({ code: 0, stdout, stderr }),
    ({ code, stdout, stderr }) => ({ code, stdout, stderr })
  )

const fakeBrowserless = page => ({ page: async () => page })

test('script receives the page, the browserless context and the flags', async t => {
  const page = { id: 'page' }
  const browserless = fakeBrowserless(page)
  const received = {}
  const opts = { script: async args => Object.assign(received, args) && undefined }
  await exec({ input: fixture('delegate.js'), browserless, opts })
  t.is(received.page, page)
  t.is(received.browserless, browserless)
  t.is(received.opts, opts)
})

for (const [name, result, expected] of [
  ['object as indented JSON', { steps: 1 }, '{\n  "steps": 1\n}'],
  ['string unchanged', 'done', 'done'],
  ['undefined as empty output', undefined, ''],
  ['buffer unchanged', Buffer.from('png'), Buffer.from('png')]
]) {
  test(`script result is printed: ${name}`, async t => {
    const opts = { script: async () => result }
    t.deepEqual(
      await exec({ input: fixture('delegate.js'), browserless: fakeBrowserless({}), opts }),
      [expected]
    )
  })
}

for (const [name, file, expected] of [
  ['ES module default export', 'default-export.mjs', 'function'],
  ['ES module with top-level await', 'top-level-await.mjs', 'awaited function'],
  ['transpiled exports.default', 'transpiled-default.js', 'function']
]) {
  test(`${name} is accepted`, async t => {
    const page = { goto: () => {} }
    t.deepEqual(await exec({ input: fixture(file), browserless: fakeBrowserless(page) }), [
      expected
    ])
  })
}

test('missing script file is rejected with its resolved path', async t => {
  await t.throwsAsync(exec({ input: 'nowhere.js', browserless: fakeBrowserless({}) }), {
    message: `Script file not found: ${path.resolve('nowhere.js')}`
  })
})

test('missing file argument is rejected before a page is opened', async t => {
  let pages = 0
  const browserless = { page: async () => pages++ }
  await t.throwsAsync(exec({ browserless }), { message: /browserless exec <file>/ })
  t.is(pages, 0)
})

test('script without a function export is rejected before a page is opened', async t => {
  let pages = 0
  const browserless = { page: async () => pages++ }
  await t.throwsAsync(exec({ input: fixture('not-a-function.js'), browserless }), {
    message: /must export a function/
  })
  t.is(pages, 0)
})

test('browserless exec runs a script against a real page', async t => {
  const { code, stderr } = await runCli(['exec', fixture('title.js'), '--title=from-exec'])
  t.is(code, 0)
  t.is(stderr.trim(), '{\n  "title": "from-exec"\n}')
})

test('browserless exec resolves the file from the working directory', async t => {
  const relative = path.relative(process.cwd(), fixture('title.js'))
  const { code, stderr } = await runCli(['exec', relative, '--title=relative'])
  t.is(code, 0)
  t.true(stderr.includes('"title": "relative"'))
})

test('browserless exec prints nothing for a returned buffer', async t => {
  const { code, stdout, stderr } = await runCli(['exec', fixture('buffer.js')])
  t.is(code, 0)
  t.is(stdout + stderr, '')
})

test('browserless exec exits with code 1 when the script throws', async t => {
  const { code, stderr } = await runCli(['exec', fixture('failing.js')])
  t.is(code, 1)
  t.true(stderr.includes('script failed on purpose'))
})

test('url commands still require a valid url', async t => {
  const { code, stderr } = await runCli(['text', 'not-a-url'])
  t.is(code, 1)
  t.true(stderr.includes('Invalid URL'))
})

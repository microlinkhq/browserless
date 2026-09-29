'use strict'

const { default: test } = require('ava')

const { needsBrowser, buildTemplate } = require('../src/function')
const createFunction = require('..')({})

const noBrowser = () => {
  throw new Error('a browser should not start')
}

const withCounts = hostPage => {
  const calls = []
  const counted = Object.fromEntries(
    Object.entries(hostPage).map(([name, fn]) => [
      name,
      (...args) => {
        calls.push(name)
        return fn(...args)
      }
    ])
  )
  return { calls, counted }
}

const HOST_PAGE = {
  content: async () => '<html><h1>on demand</h1></html>',
  metadata: async () => ({ title: 'Hacker News' })
}

const run = async (snippet, hostPage = HOST_PAGE, opts = {}) => {
  const { calls, counted } = withCounts(hostPage)
  const result = await createFunction(snippet, {
    hostPage: counted,
    getBrowserless: noBrowser,
    timeout: 25000,
    ...opts
  })('https://example.com')
  return { result, calls }
}

test('a snippet that never touches the page resolves nothing', async t => {
  const { result, calls } = await run('() => 420')
  t.true(result.isFulfilled)
  t.is(result.value, 420)
  t.deepEqual(calls, [])
})

test('a page method is resolved when the snippet calls it', async t => {
  const { result, calls } = await run('async ({ page }) => (await page.content()).length')
  t.true(result.isFulfilled)
  t.is(result.value, '<html><h1>on demand</h1></html>'.length)
  t.deepEqual(calls, ['content'])
})

test('a branch the snippet does not take resolves nothing', async t => {
  const { result, calls } = await run(
    'async ({ page }) => (false ? await page.content() : "skipped")'
  )
  t.true(result.isFulfilled)
  t.is(result.value, 'skipped')
  t.deepEqual(calls, [])
})

test('only the methods the snippet reaches are resolved', async t => {
  const { result, calls } = await run('async ({ page }) => (await page.metadata()).title')
  t.true(result.isFulfilled)
  t.is(result.value, 'Hacker News')
  t.deepEqual(calls, ['metadata'])
})

test('a host page key answers without starting a browser', t => {
  t.false(needsBrowser('({ page }) => page.content()', { content: () => {} }))
})

test('a method no one provides still needs a browser', t => {
  t.true(needsBrowser('({ page }) => page.title()', { content: () => {} }))
})

test('host page methods are not serialized into the isolate', t => {
  const source = buildTemplate('CODE', {
    usesPage: true,
    needsBrowser: false,
    hostPage: { content: () => {} }
  })
  t.true(source.includes('globalThis.__isolated_host("content", args)'))
  t.false(source.includes('pageValues["content"]'))
})

test('arguments reach the host method', async t => {
  let seen
  const { result, calls } = await run('async ({ page }) => page.content("utf8")', {
    content: async encoding => {
      seen = encoding
      return `<html>${encoding}</html>`
    }
  })
  t.true(result.isFulfilled)
  t.is(result.value, '<html>utf8</html>')
  t.is(seen, 'utf8')
  t.deepEqual(calls, ['content'])
})

test('the same method and arguments resolve once', async t => {
  const { result, calls } = await run(
    'async ({ page }) => [await page.content("utf8"), await page.content("utf8")].join("|")',
    { content: async () => 'once' }
  )
  t.true(result.isFulfilled)
  t.is(result.value, 'once|once')
  t.deepEqual(calls, ['content'])
})

test('different arguments resolve separately', async t => {
  const { result, calls } = await run(
    'async ({ page }) => [await page.content("a"), await page.content("b")].join("|")',
    { content: async value => value }
  )
  t.true(result.isFulfilled)
  t.is(result.value, 'a|b')
  t.deepEqual(calls, ['content', 'content'])
})

test('a hostPage value must be a function', t => {
  t.throws(
    () => createFunction('({ page }) => page.content()', { hostPage: { content: '<html>' } }),
    {
      message: 'Expected hostPage.content to be a function'
    }
  )
})

test('a hostPage __proto__ key is rejected', t => {
  const hostPage = {}
  Object.defineProperty(hostPage, '__proto__', {
    value: () => 'nope',
    enumerable: true
  })
  t.throws(() => createFunction('({ page }) => 420', { hostPage }), {
    message: 'Expected hostPage.__proto__ not to be a method name'
  })
})

test('extendPage wins and the host method is not called', async t => {
  const { calls, counted } = withCounts({
    content: async () => 'from host',
    metadata: async () => 'meta'
  })
  const result = await createFunction(
    'async ({ page }) => [await page.content(), await page.metadata()].join("|")',
    {
      hostPage: counted,
      extendPage: { content: 'from extend' },
      getBrowserless: noBrowser,
      timeout: 25000
    }
  )('https://example.com')
  t.true(result.isFulfilled)
  t.is(result.value, 'from extend|meta')
  t.deepEqual(calls, ['metadata'])
})

test('a shadowed host method is not reachable on the channel', async t => {
  const { calls, counted } = withCounts({
    content: async () => 'from host',
    metadata: async () => 'meta'
  })
  const result = await createFunction(
    'async ({ page }) => { await page.metadata(); return globalThis.__isolated_host("content", []) }',
    {
      hostPage: counted,
      extendPage: { content: 'from extend' },
      getBrowserless: noBrowser,
      timeout: 25000
    }
  )('https://example.com')
  t.false(result.isFulfilled)
  t.is(result.value.message, 'the host does not expose this method')
  t.deepEqual(calls, ['metadata'])
})

test('eager and host-backed methods coexist on one page', async t => {
  const { calls, counted } = withCounts({ content: async () => '<html>lazy</html>' })
  const result = await createFunction(
    'async ({ page }) => [await page.url(), await page.content()].join(" ")',
    {
      hostPage: counted,
      extendPage: { url: 'https://example.com' },
      getBrowserless: noBrowser,
      timeout: 25000
    }
  )('https://example.com')
  t.true(result.isFulfilled)
  t.is(result.value, 'https://example.com <html>lazy</html>')
  t.deepEqual(calls, ['content'])
})

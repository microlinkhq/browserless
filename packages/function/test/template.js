/* eslint-disable no-new-func */

'use strict'

const { spawnSync } = require('child_process')
const test = require('ava')

const template = require('../src/template')

test('use a simplified template if page is not used', t => {
  {
    const code = () => {
      function isStrict () {
        return !this
      }
      return isStrict()
    }

    t.is(template(code.toString()).includes('puppeteer'), false)
  }
  {
    const code = () => ({ page: 'title' })
    t.is(template(code.toString()).includes('puppeteer'), false)
  }
  {
    const code = () => 'page'
    t.is(template(code.toString()).includes('puppeteer'), false)
  }
})

test('a strict target miss disconnects the browser', t => {
  const source = template('({ page }) => page.title()')
  const tryAt = source.indexOf('try {')
  const throwAt = source.indexOf('if (strictTarget) throw')
  const finallyAt = source.lastIndexOf('finally')
  t.true(tryAt !== -1 && tryAt < throwAt && throwAt < finallyAt)
})

test('require puppeteer if page is used', t => {
  {
    const code = ({ page }) => page.title()
    t.is(template(code.toString()).includes('puppeteer'), true)
  }
  {
    const code = ({ page: p }) => p.title()
    t.is(template(code.toString()).includes('puppeteer'), true)
  }
  {
    const code = obj => obj.page.title()
    t.is(template(code.toString()).includes('puppeteer'), true)
  }
  {
    const code = obj => (() => obj.page.title())()
    t.is(template(code.toString()).includes('puppeteer'), true)
  }
  {
    const code = ({ ...page }) => page.title
    t.is(template(code.toString()).includes('puppeteer'), true)
  }
  {
    const code = obj => obj.page.title()
    t.is(template(code.toString()).includes('puppeteer'), true)
  }
})

test('non-page template reconstructs response methods from _response', async t => {
  const code = '({ response }) => ({ status: response.status(), ok: response.ok() })'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {
    _response: { status: 200, ok: true }
  })
  t.deepEqual(result, { status: 200, ok: true })
})

test('response is undefined when _response is absent', async t => {
  const code = '({ response }) => response'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {})
  t.is(result, undefined)
})

test('_response is not leaked to user function opts', async t => {
  const code = '(opts) => Object.keys(opts).sort()'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {
    _response: { status: 200 },
    query: { foo: 'bar' }
  })
  t.deepEqual(result, ['query', 'response', 'url'])
})

test('non-page template passes url to the user function', async t => {
  const code = '({ url }) => url'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {})
  t.is(result, 'https://example.com')
})

test('page template includes url in function call', t => {
  const code = '({ page, url }) => url'
  const source = template(code)
  t.true(source.includes('{ page, response, ...rest, url }'))
})

test('stub-page template passes url to the user function', async t => {
  const code = 'async ({ page, url }) => ({ url, html: await page.html() })'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: { html: '<p>hi</p>' }
  })
  t.true(source.includes('{ page, response, ...rest, url }'))
  t.false(source.includes('puppeteer'))
  const fn = new Function(`return (${source})`)()
  t.deepEqual(
    await fn('https://example.com', undefined, {
      pageValues: { html: '<p>hi</p>' }
    }),
    { url: 'https://example.com', html: '<p>hi</p>' }
  )
})

test('stub-page target url wins over opts.url', async t => {
  const code = '({ page, url }) => url'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: { html: '<p>hi</p>' }
  })
  const fn = new Function(`return (${source})`)()
  t.is(
    await fn('https://example.com', undefined, {
      url: 'https://other.example',
      pageValues: { html: '<p>hi</p>' }
    }),
    'https://example.com'
  )
})

test('target url wins over opts.url', async t => {
  const code = '({ url }) => url'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {
    url: 'https://other.example'
  })
  t.is(result, 'https://example.com')
})

test('page template includes response in function call', t => {
  const code = '({ page, response }) => response.status()'
  const source = template(code)
  t.true(source.includes('response'))
  t.true(source.includes('_response'))
  t.true(source.includes('...rest'))
})

test('needsBrowser is true when page access is not a stub', t => {
  t.true(template.needsBrowser('({ page }) => page.content()'))
  t.true(template.needsBrowser('({ page }) => page.url()'))
  t.true(template.needsBrowser('({ page }) => page.title()'))
  t.true(template.needsBrowser('({ page }) => "ok"'))
  t.true(template.needsBrowser('({ page, response }) => response.status()'))
})

test('needsBrowser treats extendPage keys as stubs', t => {
  t.false(template.needsBrowser('({ page }) => page.ping()', { ping: 'pong' }))
  t.false(template.needsBrowser('({ page: p }) => p.ping()', { ping: 'pong' }))
  t.false(template.needsBrowser('({ page }) => page.html()', { html: '<p>hi</p>' }))
  t.false(template.needsBrowser('({ page }) => page.url()', { url: 'https://example.com' }))
  t.true(template.needsBrowser('({ page }) => page.title()', { ping: 'pong' }))
})

test('extendPage JSON values become async getters on a stub page', async t => {
  const code = '({ page }) => page.ping()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: { ping: 'pong' }
  })
  t.false(source.includes('puppeteer'))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, { pageValues: { ping: 'pong' } }), 'pong')
})

test('extendPage url and html are stub methods', async t => {
  const code = 'async ({ page }) => ({ url: await page.url(), html: await page.html() })'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: { url: 'https://example.com', html: '<p>hi</p>' }
  })
  const fn = new Function(`return (${source})`)()
  t.deepEqual(
    await fn('https://other.example', undefined, {
      pageValues: { url: 'https://example.com', html: '<p>hi</p>' }
    }),
    { url: 'https://example.com', html: '<p>hi</p>' }
  )
})

test('extendPage method shorthand with an arrow in the body still inlines', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      html: '<h1>ok</h1>',
      echo () {
        const pick = () => this.html()
        return pick()
      }
    }
  })
  t.true(source.includes('async function ('))
  const fn = new Function(`return (${source})`)()
  t.is(
    await fn('https://example.com', undefined, { pageValues: { html: '<h1>ok</h1>' } }),
    '<h1>ok</h1>'
  )
})

test('extendPage method shorthand is inlined as a function expression', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      html: '<h1>ok</h1>',
      echo () {
        return this.html()
      }
    }
  })
  t.false(source.includes('puppeteer'))
  t.true(source.includes('async function ('))
  const fn = new Function(`return (${source})`)()
  t.is(
    await fn('https://example.com', undefined, { pageValues: { html: '<h1>ok</h1>' } }),
    '<h1>ok</h1>'
  )
})

test('extendPage quoted method keys inline as anonymous functions', async t => {
  const code = '({ page }) => page["cache-status"]()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      'cache-status' () {
        return 'ok'
      }
    }
  })
  t.true(source.includes('async function ('))
  t.false(source.includes("function 'cache-status'"))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, {}), 'ok')
})

test('extendPage arrows cannot use this', t => {
  t.throws(
    () =>
      template('({ page }) => page.echo()', {
        usesPage: true,
        needsBrowser: false,
        extendPage: {
          echo: () => this.html()
        }
      }),
    { message: /cannot use `this`/ }
  )
})

test('extendPage arrows without this stay arrows', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      echo: () => 'pong'
    }
  })
  t.true(source.includes('async () =>'))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, {}), 'pong')
})

test('extendPage methods can await', async t => {
  const code = '({ page }) => page.delay(1)'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      delay: async (...args) => {
        await new Promise(resolve => setTimeout(resolve, ...args))
        return args[0]
      }
    }
  })
  t.true(source.includes('async ('))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, {}), 1)
})

test('extendPage functions can read stub page.html', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      html: '<h1>ok</h1>',
      echo: async function echo () {
        return this.html()
      }
    }
  })
  t.false(source.includes('puppeteer'))
  const fn = new Function(`return (${source})`)()
  t.is(
    await fn('https://example.com', undefined, { pageValues: { html: '<h1>ok</h1>' } }),
    '<h1>ok</h1>'
  )
})

test('pageValues is not leaked to user function opts', async t => {
  const code = '(opts) => Object.keys(opts).sort()'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {
    pageValues: { ping: 'pong' },
    query: { foo: 'bar' }
  })
  t.deepEqual(result, ['query', 'response', 'url'])
})

test('reuse page usage analysis to avoid parsing code twice', t => {
  const templatePath = require.resolve('../src/template')
  const script = `
    const Module = require('module')
    const originalLoad = Module._load
    let parseCalls = 0

    Module._load = function (request, parent, isMain) {
      if (request === 'acorn') {
        const acorn = originalLoad(request, parent, isMain)
        return {
          ...acorn,
          parse (...args) {
            parseCalls += 1
            return acorn.parse(...args)
          }
        }
      }
      return originalLoad(request, parent, isMain)
    }

    const template = require(${JSON.stringify(templatePath)})
    const code = '({ page }) => page.title()'
    const usesPage = template.isUsingPage(code)
    template(code, usesPage)
    process.stdout.write(String(parseCalls))
  `

  const { status, stdout, stderr } = spawnSync(process.execPath, ['-e', script], {
    encoding: 'utf8'
  })

  t.is(status, 0, stderr)
  t.is(stdout.trim(), '1')
})

test('parse errors do not reuse a previous AST', t => {
  t.true(template.isUsingPage('({ page }) => page.title()'))
  t.throws(() => template.isUsingPage('not valid !!!'), { instanceOf: SyntaxError })
  t.throws(() => template.isUsingPage('not valid !!!'), { instanceOf: SyntaxError })
})

test('inspect is exported from the package', t => {
  t.is(require('..').inspect, template.inspect)
})

test('inspect collects page.extract methods and nested keys', t => {
  const { methods, calls } = template.inspect(
    "({ page }) => page.extract({ version: { evaluate: 'window.next.version' } })"
  )
  t.deepEqual([...methods], ['extract'])
  t.is(calls.length, 1)
  t.is(calls[0].method, 'extract')
  t.false('arguments' in calls[0])
  t.true(calls[0].keys.has('version'))
  t.true(calls[0].keys.has('evaluate'))
})

test('inspect follows renamed page and quoted access', t => {
  t.true(
    template
      .inspect("({ page: p }) => p.extract({ version: { evaluate: 'x' } })")
      .methods.has('extract')
  )
  t.true(
    template
      .inspect("({ page }) => page['extract']({ version: { evaluate: 'x' } })")
      .methods.has('extract')
  )
  t.true(
    template
      .inspect('({ page }) => page["extract"]({ version: { evaluate: "x" } })')
      .methods.has('extract')
  )
  t.true(
    template
      .inspect('obj => obj.page.extract({ title: { selector: "h1" } })')
      .methods.has('extract')
  )
})

test('inspect does not treat a later evaluate key as part of extract', t => {
  const { calls } = template.inspect(
    '({ page }) => page.extract({ title: { selector: "h1" } }) && ({ evaluate: 1 })'
  )
  t.is(calls[0].method, 'extract')
  t.false(calls[0].keys.has('evaluate'))
  t.true(calls[0].keys.has('title'))
})

test('inspect does not see evaluate on a rules identifier', t => {
  const { calls } = template.inspect(
    "({ page }) => { const rules = { evaluate: 'x' }; return page.extract(rules) }"
  )
  t.is(calls[0].method, 'extract')
  t.false(calls[0].keys.has('evaluate'))
})

test('inspect records page.metadata without a call argument', t => {
  const { methods, calls } = template.inspect('({ page }) => page.metadata()')
  t.true(methods.has('metadata'))
  t.is(calls[0].method, 'metadata')
  t.is(calls[0].keys.size, 0)
})

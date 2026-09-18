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

test('needsBrowser is false when page is only used as content', t => {
  t.false(template.needsBrowser('({ page }) => page.content()'))
  t.true(template.needsBrowser('({ page }) => page.title()'))
  t.true(template.needsBrowser('({ page }) => "ok"'))
  t.true(template.needsBrowser('({ page, response }) => response.status()'))
})

test('needsBrowser treats extendPage keys as stubs', t => {
  t.false(template.needsBrowser('({ page }) => page.ping()', { ping: 'pong' }))
  t.false(template.needsBrowser('({ page: p }) => p.ping()', { ping: 'pong' }))
  t.true(template.needsBrowser('({ page }) => page.title()', { ping: 'pong' }))
})

test('stub page template skips puppeteer and exposes content', async t => {
  const code = '({ page }) => page.content()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false
  })
  t.false(source.includes('puppeteer'))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, { _html: '<p>hi</p>' }), '<p>hi</p>')
})

test('extendPage JSON values become async getters on a stub page', async t => {
  const code = '({ page }) => page.ping()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: { ping: 'pong' }
  })
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, { _extendPage: { ping: 'pong' } }), 'pong')
})

test('extendPage method shorthand with an arrow in the body still inlines', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      echo () {
        const pick = () => this.content()
        return pick()
      }
    }
  })
  t.true(source.includes('function ('))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, { _html: '<h1>ok</h1>' }), '<h1>ok</h1>')
})

test('extendPage method shorthand is inlined as a function expression', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      echo () {
        return this.content()
      }
    }
  })
  t.false(source.includes('puppeteer'))
  t.true(source.includes('function ('))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, { _html: '<h1>ok</h1>' }), '<h1>ok</h1>')
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
  t.true(source.includes('function ('))
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
          echo: () => this.content()
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
  t.true(source.includes('() =>'))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, {}), 'pong')
})

test('extendPage functions can read stub page.content', async t => {
  const code = '({ page }) => page.echo()'
  const source = template(code, {
    usesPage: true,
    needsBrowser: false,
    extendPage: {
      echo: async function echo () {
        return this.content()
      }
    }
  })
  t.false(source.includes('puppeteer'))
  const fn = new Function(`return (${source})`)()
  t.is(await fn('https://example.com', undefined, { _html: '<h1>ok</h1>' }), '<h1>ok</h1>')
})

test('_extendPage and _html are not leaked to user function opts', async t => {
  const code = '(opts) => Object.keys(opts).sort()'
  const source = template(code)
  const fn = new Function(`return (${source})`)()
  const result = await fn('https://example.com', undefined, {
    _html: '<p>x</p>',
    _extendPage: { ping: 'pong' },
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

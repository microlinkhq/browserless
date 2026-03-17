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
  t.deepEqual(result, ['query', 'response'])
})

test('page template includes response in function call', t => {
  const code = '({ page, response }) => response.status()'
  const source = template(code)
  t.true(source.includes('response'))
  t.true(source.includes('_response'))
  t.true(source.includes('...rest'))
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

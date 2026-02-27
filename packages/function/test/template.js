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

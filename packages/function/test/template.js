'use strict'

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

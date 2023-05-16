'use strict'

const { getBrowser } = require('@browserless/test/util')
const cheerio = require('cheerio')
const test = require('ava')

const browser = getBrowser()

test('graphics features', async t => {
  const browserless = await browser.createContext()

  t.teardown(browserless.destroyContext)

  const page = await browserless.page()
  await page.goto('chrome://gpu/')

  const html = await page.evaluate(() => document.querySelector('info-view').shadowRoot.innerHTML)
  await page.close()

  const $ = cheerio.load(html)

  const props = []

  $('.feature-status-list li').each(function () {
    props.push($(this).text().split(': '))
  })

  const gpu = Object.fromEntries(props)
  t.is(gpu.WebGL, 'Software only, hardware acceleration unavailable')
  t.is(gpu.WebGL2, 'Software only, hardware acceleration unavailable')
})

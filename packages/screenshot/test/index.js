'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const cheerio = require('cheerio')
const test = require('ava')

test.only('graphics features', async t => {
  const browserless = await getBrowserContext(t)

  const getGpu = browserless.withPage(page => async () => {
    await page.goto('chrome://gpu/')

    const html = await page.evaluate(() => document.querySelector('info-view').shadowRoot.innerHTML)
    await page.close()

    const $ = cheerio.load(html)

    const props = []

    $('.feature-status-list li').each(function () {
      props.push($(this).text().split(': '))
    })

    return Object.fromEntries(props)
  })

  const gpu = await getGpu()

  console.log('graphics features', gpu)

  t.is(gpu.WebGL, 'Software only, hardware acceleration unavailable')
  t.is(gpu.WebGL2, 'Software only, hardware acceleration unavailable')
})

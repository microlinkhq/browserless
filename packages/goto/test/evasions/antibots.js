'use strict'

const test = require('ava')

const createBrowserless = require('browserless')

const browserless = createBrowserless()

test('https://arh.antoinevastel.com/bots/areyouheadless', async t => {
  const content = await browserless.text('https://arh.antoinevastel.com/bots/areyouheadless')
  t.true(content.includes('You are not Chrome headless'))
})

// See https://antoinevastel.com/bot%20detection/2018/11/13/fp-scanner-library-demo.html
test.only('https://antoinevastel.com/bots/fpstructured', async t => {
  const fpCollect = browserless.evaluate((page, response) =>
    page.evaluate(() => {
      const fp = JSON.parse(document.getElementById('fp').innerText)
      const scanner = JSON.parse(document.getElementById('scanner').innerText)
      return { fp, scanner }
    })
  )

  const { fp, scanner } = await fpCollect('https://antoinevastel.com/bots/fpstructured')
  console.log(fp)
  Object.keys(scanner)
    .filter(key => key !== 'CHR_MEMORY') // https://github.com/antoinevastel/fpscanner/issues/9
    .forEach(scannerKey => {
      const scannerValue = scanner[scannerKey]
      t.true(scannerValue.consistent === 3, `${scannerKey} is inconsistent`)
    })
})

'use strict'

const createPdf = require('@browserless/pdf')
const path = require('path')
const fs = require('fs')
const test = require('ava')

const whiteScreenshot = fs.readFileSync(
  path.resolve(__dirname, '../../screenshot/test/fixtures/white-5k.png')
)

const noWhiteScreenshot = fs.readFileSync(
  path.resolve(__dirname, '../../screenshot/test/fixtures/no-white-5k.png')
)

test('waitUntil auto should generate final pdf once', async t => {
  let screenshotCalls = 0
  let pdfCalls = 0
  let waitUntilAutoCalls = 0

  const page = {
    screenshot: async () => (screenshotCalls++ === 0 ? whiteScreenshot : noWhiteScreenshot),
    pdf: async () => {
      pdfCalls += 1
      return Buffer.from(`pdf-${pdfCalls}`)
    }
  }

  const goto = async (page, opts = {}) => {
    if (opts.waitUntilAuto) await opts.waitUntilAuto(page)
    return { response: {} }
  }

  goto.timeouts = {
    action: () => 100000
  }

  goto.waitUntilAuto = async () => {
    waitUntilAutoCalls += 1
  }

  const pdf = createPdf({ goto })(page)
  const buffer = await pdf('https://example.com', { waitUntil: 'auto', timeout: 500 })

  t.true(Buffer.isBuffer(buffer))
  t.is(pdfCalls, 1)
  t.true(screenshotCalls >= 2)
  t.is(waitUntilAutoCalls, 1)
})

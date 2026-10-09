'use strict'

const { getBrowserContext, runServer } = require('@browserless/test')
const test = require('ava')

const createScreenshot = require('..')

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])
const FULL_PAGE_PNG_PIXELS = 40000000

const pngSize = buf => {
  const bytes = Buffer.from(buf)
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

const page = height =>
  `<!doctype html><body style="margin:0"><div style="height:${height}px;background:#123456"></div></body>`

const shoot = async (t, html, viewport) => {
  const browserless = await getBrowserContext(t)
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })
  return browserless.withPage((browserPage, goto) => async () => {
    const screenshot = createScreenshot({ goto })(browserPage)
    return screenshot(url, {
      adblock: false,
      fullPage: true,
      timeout: 20000,
      type: 'png',
      viewport,
      waitUntil: 'load'
    })
  })()
}

test('a full page past the png budget is scaled down', async t => {
  const data = await shoot(t, page(20000), { deviceScaleFactor: 2, height: 800, width: 1280 })
  t.deepEqual(Buffer.from(data.subarray(0, 4)), PNG_MAGIC)
  const { height, width } = pngSize(data)
  t.true(width * height <= FULL_PAGE_PNG_PIXELS)
  t.true(height < 20000 * 2)
})

test('a full page inside the png budget stays full resolution', async t => {
  const data = await shoot(t, page(400), { deviceScaleFactor: 2, height: 800, width: 1280 })
  t.deepEqual(Buffer.from(data.subarray(0, 4)), PNG_MAGIC)
  const { height } = pngSize(data)
  t.true(height >= 400 * 2)
})

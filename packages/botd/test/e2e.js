'use strict'

const { runServer, getBrowserContext } = require('@browserless/test')
const { default: test } = require('ava')
const check = require('..')

const html = '<!doctype html><title>botd</title><p>ok</p>'

test('stock BotD does not flag a page opened through goto', async t => {
  const url = await runServer(t, ({ res }) => {
    res.setHeader('content-type', 'text/html')
    res.end(html)
  })
  const browserless = await getBrowserContext(t)
  const page = await browserless.page()
  t.teardown(() => page.close())
  await browserless.goto(page, { url })
  const report = await check(page)
  const again = await check(page)
  const flagged = report.detectors.filter(detector => detector.bot).map(detector => detector.name)
  t.deepEqual(flagged, [])
  t.false(report.bot)
  t.is(report.kind, null)
  t.deepEqual(report.trapped, [])
  t.deepEqual(again, report)
})

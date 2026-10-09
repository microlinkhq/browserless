'use strict'

const { readFileSync } = require('node:fs')
const { getPage } = require('@browserless/test')
const test = require('ava')
const {
  baseSource,
  between,
  denseHtml,
  expression,
  gate,
  timeInPage
} = require('@browserless/test/perf')

test.serial('dismiss scan stays at or under the pull request base', async t => {
  const base = baseSource('packages/goto/src/dismiss.js')
  if (!base) return t.pass()
  const head = readFileSync(require.resolve('../src/dismiss'), 'utf8')
  const slice = source => {
    const body = between(source, 'const dismissOverlays = ', '\nconst WORLD_NAME')
    if (!body) throw new Error('missing dismissOverlays')
    return expression(body)
  }
  const page = await getPage(t)
  await page.setViewport({ width: 1280, height: 800 })
  await page.setContent(denseHtml())
  gate(t, [
    {
      name: 'dismiss',
      ...(await timeInPage(page, slice(head), slice(base), { isolate: true }))
    }
  ])
})

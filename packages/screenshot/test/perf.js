'use strict'

const { readFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { getPage } = require('@browserless/test')
const test = require('ava')
const {
  baseSource,
  between,
  denseHtml,
  expression,
  gate,
  loadModule,
  timeInPage,
  timePair
} = require('@browserless/test/perf')

const pageFn = (source, start, end) => {
  const slice = between(source, start, end)
  if (!slice) throw new Error(`missing ${start}`)
  return expression(slice)
}

test.serial('screenshot hot paths stay at or under the pull request base', async t => {
  const rows = []
  const whiteBase = baseSource('packages/screenshot/src/is-white-screenshot.js')
  if (whiteBase) {
    const head = require('../src/is-white-screenshot')
    const base = loadModule(whiteBase, createRequire(require.resolve('../package.json')))
    const data = Buffer.alloc(1200 * 1200 * 4, 250)
    const info = { width: 1200, height: 1200, channels: 4 }
    rows.push({
      name: 'white',
      ...timePair(
        () => head.isWhiteSampledImage(data, info),
        () => base.isWhiteSampledImage(data, info)
      )
    })
  }
  const overflowBase = baseSource('packages/screenshot/src/prepare-full-document.js')
  if (overflowBase) {
    const headFile = readFileSync(require.resolve('../src/prepare-full-document'), 'utf8')
    const page = await getPage(t)
    await page.setViewport({ width: 1280, height: 800 })
    await page.setContent(denseHtml())
    rows.push({
      name: 'overflow',
      ...(await timeInPage(
        page,
        pageFn(headFile, 'function findTallestOverflowScroller', '\nconst evaluateInPage'),
        pageFn(overflowBase, 'function findTallestOverflowScroller', '\nconst evaluateInPage')
      ))
    })
  }
  gate(t, rows)
})

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
  namedConst,
  timeInPage,
  timePair
} = require('@browserless/test/perf')

const pageFn = (source, start, end) => {
  const slice = between(source, start, end)
  if (!slice) throw new Error(`missing ${start}`)
  return expression(slice)
}

// Screenshot, PDF, and HTML all pay these paths. The owning packages gate them too.
test.serial('core capture paths stay at or under the pull request base', async t => {
  const rows = []
  const whiteBase = baseSource('packages/screenshot/src/is-white-screenshot.js')
  if (whiteBase) {
    const head = require('@browserless/screenshot/src/is-white-screenshot')
    const base = loadModule(
      whiteBase,
      createRequire(require.resolve('@browserless/screenshot/package.json'))
    )
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
  const page = await getPage(t)
  await page.setViewport({ width: 1280, height: 800 })
  await page.setContent(denseHtml())
  const overflowBase = baseSource('packages/screenshot/src/prepare-full-document.js')
  if (overflowBase) {
    const headFile = readFileSync(
      require.resolve('@browserless/screenshot/src/prepare-full-document'),
      'utf8'
    )
    rows.push({
      name: 'overflow',
      ...(await timeInPage(
        page,
        pageFn(headFile, 'function findTallestOverflowScroller', '\nconst evaluateInPage'),
        pageFn(overflowBase, 'function findTallestOverflowScroller', '\nconst evaluateInPage'),
        {
          headArgs: [namedConst(headFile, 'OVERFLOW_MIN_PX')],
          baseArgs: [namedConst(overflowBase, 'OVERFLOW_MIN_PX')]
        }
      ))
    })
  }
  const dismissBase = baseSource('packages/goto/src/dismiss.js')
  if (dismissBase) {
    const headFile = readFileSync(require.resolve('@browserless/goto/src/dismiss'), 'utf8')
    const slice = source =>
      expression(between(source, 'const dismissOverlays = ', '\nconst WORLD_NAME'))
    rows.push({
      name: 'dismiss',
      ...(await timeInPage(page, slice(headFile), slice(dismissBase), { isolate: true }))
    })
  }
  gate(t, rows)
})

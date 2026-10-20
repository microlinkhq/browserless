'use strict'

const { default: test } = require('ava')

const check = require('..')

const page = payload => ({
  evaluate: async () => payload
})

const payload = (overrides = {}) => ({
  bot: false,
  kind: null,
  detections: {
    detectWebDriver: { bot: false },
    detectWebGL: { bot: false }
  },
  trapped: [],
  ...overrides
})

test('a trapped source stays out of the verdict', async t => {
  const report = await check(
    page(
      payload({
        trapped: ['rtt']
      })
    )
  )
  t.false(report.bot)
  t.is(report.kind, null)
  t.deepEqual(report.trapped, ['rtt'])
  t.deepEqual(report.detectors, [
    { name: 'detectWebDriver', bot: false, kind: null },
    { name: 'detectWebGL', bot: false, kind: null }
  ])
})

test('detectors keep getDetections order, including passes', async t => {
  const report = await check(
    page(
      payload({
        bot: true,
        kind: 'headless_chrome',
        detections: {
          detectAppVersion: { bot: false },
          detectWebDriver: { bot: true, botKind: 'headless_chrome' }
        }
      })
    )
  )
  t.deepEqual(report, {
    bot: true,
    kind: 'headless_chrome',
    detectors: [
      { name: 'detectAppVersion', bot: false, kind: null },
      { name: 'detectWebDriver', bot: true, kind: 'headless_chrome' }
    ],
    trapped: []
  })
})

test('throws when the aggregate disagrees with the detector list', async t => {
  await t.throwsAsync(() =>
    check(
      page(
        payload({
          detections: {
            detectWebDriver: { bot: true, botKind: 'headless_chrome' }
          }
        })
      )
    )
  )
  await t.throwsAsync(() =>
    check(
      page(
        payload({
          bot: true,
          kind: 'headless_chrome'
        })
      )
    )
  )
  await t.throwsAsync(() =>
    check(
      page(
        payload({
          kind: 'headless_chrome'
        })
      )
    )
  )
})

test('throws when detections is empty', async t => {
  await t.throwsAsync(() => check(page(payload({ detections: {} }))))
  await t.throwsAsync(() => check(page(payload({ detections: null }))))
})

test('throws when a hit has no kind', async t => {
  await t.throwsAsync(() =>
    check(
      page(
        payload({
          bot: true,
          kind: 'headless_chrome',
          detections: {
            detectWebDriver: { bot: true }
          }
        })
      )
    )
  )
  await t.throwsAsync(() =>
    check(
      page(
        payload({
          bot: true,
          kind: null,
          detections: {
            detectWebDriver: { bot: true, botKind: 'headless_chrome' }
          }
        })
      )
    )
  )
  await t.throwsAsync(() =>
    check(
      page(
        payload({
          bot: true,
          kind: '',
          detections: {
            detectWebDriver: { bot: true, botKind: 'headless_chrome' }
          }
        })
      )
    )
  )
})

test('throws when trapped is not an array of non-empty strings', async t => {
  const trappedValues = [undefined, null, 'rtt', [''], [1], ['rtt', ''], [null]]
  for (const trapped of trappedValues) {
    await t.throwsAsync(() => check(page(payload({ trapped }))))
  }
})

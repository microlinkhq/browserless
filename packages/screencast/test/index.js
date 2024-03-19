'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const test = require('ava')

const createScreencast = require('..')

test('capture frames', async t => {
  const frames = []

  const browserless = await getBrowserContext(t)
  const page = await browserless.page()

  const screencast = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  screencast.onFrame((data, metadata) => {
    frames.push({ data, metadata })
  })

  screencast.start()
  await page.goto('https://example.com', { waitUntil: 'domcontentloaded' })
  await screencast.stop()

  frames.forEach(({ data, metadata }) => {
    t.truthy(data)
    t.is(typeof metadata, 'object')
    t.truthy(metadata.timestamp)
  })
})

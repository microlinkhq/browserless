'use strict'

const { getBrowserContext } = require('@browserless/test')
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

test('clean up cdp frame listeners across screencast sessions', async t => {
  const browserless = await getBrowserContext(t)
  const page = await browserless.page()
  const cdp = page._client()

  const countListeners = () => cdp.listenerCount('Page.screencastFrame')

  const screencastA = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  t.is(countListeners(), 0)

  await screencastA.start()
  t.is(countListeners(), 1)
  await screencastA.stop()
  t.is(countListeners(), 0)

  const screencastB = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  await screencastB.start()
  t.is(countListeners(), 1)
  await screencastB.stop()
  t.is(countListeners(), 0)
})

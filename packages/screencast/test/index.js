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

  await screencast.start()
  await page.goto('https://example.com', { waitUntil: 'load' })

  // Page.startScreencast emits a frame per compositor commit. Under the GL
  // backend a fully static page may not commit again after the initial paint,
  // so drive a visual change each tick to force commits and poll until the
  // screencast captures at least one frame.
  const deadline = Date.now() + 5000
  while (frames.length === 0 && Date.now() < deadline) {
    await page.evaluate(() => {
      document.body.style.background = `hsl(${Date.now() % 360}, 50%, 50%)`
    })
    await new Promise(resolve => setTimeout(resolve, 50))
  }

  await screencast.stop()

  t.true(frames.length > 0)
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

  screencastA.onFrame(() => {})
  await screencastA.start()
  t.is(countListeners(), 1)
  await screencastA.stop()
  t.is(countListeners(), 0)

  const screencastB = createScreencast(page, {
    quality: 0,
    format: 'png',
    everyNthFrame: 1
  })

  screencastB.onFrame(() => {})
  await screencastB.start()
  t.is(countListeners(), 1)
  await screencastB.stop()
  t.is(countListeners(), 0)
})

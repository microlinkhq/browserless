'use strict'

const pReflect = require('p-reflect')
const test = require('ava')

const createScreenshot = require('..')

const BOX = { x: 10, y: 20, width: 320, height: 120 }

const createGoto = () => {
  const goto = async () => ({ response: { headers: () => ({}) } })
  goto.run = ({ fn }) => pReflect(fn)
  goto.timeouts = { action: () => 1000, goto: () => 1000 }
  goto.waitUntilAuto = async () => {}
  return goto
}

const createPage = boxes => {
  const page = {
    waitForSelectorCalls: 0,
    screenshots: [],
    on: () => {},
    off: () => {},
    isClosed: () => false,
    evaluate: async () => undefined,
    waitForSelector: async () => {
      const box = boxes[Math.min(page.waitForSelectorCalls++, boxes.length - 1)]
      if (box instanceof Error) throw box
      return { boundingBox: async () => box, dispose: async () => {} }
    },
    screenshot: async opts => {
      page.screenshots.push(opts)
      return Buffer.from('shot')
    }
  }
  return page
}

const capture = page =>
  createScreenshot({ goto: createGoto() })(page)('https://example.com', {
    waitUntil: 'load',
    element: '#card',
    codeScheme: false
  })

test('element clip is read once when the matched node is stable', async t => {
  const page = createPage([BOX])
  await capture(page)
  t.is(page.waitForSelectorCalls, 1)
  t.deepEqual(page.screenshots[0].clip, BOX)
})

test('element clip re-queries when the matched node is replaced before it is measured', async t => {
  const page = createPage([null, BOX])
  await capture(page)
  t.is(page.waitForSelectorCalls, 2)
  t.is(page.screenshots.length, 1)
  t.deepEqual(page.screenshots[0].clip, BOX)
})

test('element screenshot throws instead of capturing the viewport when the node keeps detaching', async t => {
  const page = createPage([null])
  await t.throwsAsync(capture(page), { message: /#card/ })
  t.is(page.screenshots.length, 0)
})

test('element screenshot throws when the re-query fails after the node detached', async t => {
  const timedOut = new Error('Waiting for selector `#card` failed: Waiting failed: 1000ms exceeded')
  const page = createPage([null, timedOut])
  await t.throwsAsync(capture(page), { message: /detached/ })
  t.is(page.screenshots.length, 0)
})

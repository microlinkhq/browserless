'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const FileType = require('file-type')
const test = require('ava')

const screencast = require('..')

test('get a webm video', async t => {
  const browserless = await getBrowserContext(t)

  const buffer = await screencast({
    getBrowserless: () => browserless,
    videoFormat: 'webm',
    gotoOpts: {
      url: 'https://vercel.com',
      animations: true,
      abortTypes: [],
      waitUntil: 'load'
    },
    withPage: async page => {
      const TOTAL_TIME = 7_000

      const timing = {
        topToQuarter: (TOTAL_TIME * 1.5) / 7,
        quarterToQuarter: (TOTAL_TIME * 0.3) / 7,
        quarterToBottom: (TOTAL_TIME * 1) / 7,
        bottomToTop: (TOTAL_TIME * 2) / 7
      }

      const scrollTo = (partial, ms) =>
        page.evaluate(
          (partial, ms) =>
            new Promise(resolve => {
              window.requestAnimationFrame(() => {
                window.scrollTo({
                  top: document.scrollingElement.scrollHeight * partial,
                  behavior: 'smooth'
                })
                setTimeout(resolve, ms)
              })
            }),
          partial,
          ms
        )

      await scrollTo(1 / 3, timing.topToQuarter)
      await scrollTo(2 / 3, timing.quarterToQuarter)
      await scrollTo(3 / 3, timing.quarterToBottom)
      await scrollTo(0, timing.bottomToTop)
    }
  })

  const { ext, mime } = await FileType.fromBuffer(buffer)

  require('fs').writeFileSync('video.webm', buffer)

  t.is(ext, 'webm')
  t.is(mime, 'video/webm')
})

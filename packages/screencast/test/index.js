'use strict'

const { getBrowserContext } = require('@browserless/test/util')
const { writeFile } = require('fs/promises')
const { randomUUID } = require('crypto')
const FileType = require('file-type')
const { unlinkSync } = require('fs')
const { tmpdir } = require('os')
const execa = require('execa')
const isCI = require('is-ci')
const path = require('path')
const test = require('ava')

const screencast = require('..')

test('get a webm video', async t => {
  const browserless = await getBrowserContext(t)

  const buffer = await screencast({
    getBrowserless: () => browserless,
    ffmpegPath: await execa.command('which ffmpeg').then(({ stdout }) => stdout),
    frames: {
      everyNthFrame: 2
    },
    gotoOpts: {
      url: 'https://vercel.com',
      animations: true,
      abortTypes: [],
      waitUntil: 'load'
    },
    withPage: async page => {
      const TOTAL_TIME = 7_000 * isCI ? 0.5 : 1

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
  t.is(ext, 'webm')
  t.is(mime, 'video/webm')

  const filepath = path.join(tmpdir(), randomUUID())
  t.teardown(() => unlinkSync(filepath))
  await writeFile(filepath, buffer)

  const ffprobe = await execa
    .command(`ffprobe ${filepath} -print_format json -show_format -show_streams`)
    .then(({ stdout }) => JSON.parse(stdout))

  t.is(ffprobe.streams[0].codec_name, 'vp9')
  t.is(ffprobe.streams[0].pix_fmt, 'yuv420p')
  t.is(ffprobe.streams[0].avg_frame_rate, '25/1')
})

'use strict'

const { setTimeout: delay } = require('timers/promises')
const { Writable } = require('stream')
const fs = require('fs/promises')
const debug = require('debug-logfmt')('browserless:capture')

const createCapture = require('../create-capture')
const { even } = require('../recorder')
const { DEFAULT, NOOP } = require('../constants')

const isWebm = type => String(type).trim().toLowerCase().replace(/^\./, '') === 'webm'

const runRecord = async (page, opts, viewport, { onStarted } = {}) => {
  if (opts.video === false) {
    throw new TypeError('The record mode captures video; `video` cannot be disabled.')
  }
  if (opts.type !== undefined && isWebm(opts.type)) {
    throw new TypeError('The record mode outputs mp4; `type` cannot be `webm`.')
  }
  if (typeof page.record !== 'function') {
    throw new Error('page.record() requires puppeteer >= 25.10 and Chrome M153+.')
  }

  const { path: outputPath, duration = DEFAULT.duration, fps = DEFAULT.fps, audio = false } = opts
  const recorder = await page.record({
    audio: Boolean(audio),
    frameRate: fps,
    maxWidth: even(viewport.width),
    maxHeight: even(viewport.height)
  })

  const chunks = []
  const recordingWindow = new AbortController()
  let captureError
  let navigation = Promise.resolve()

  // Start the source, then navigate concurrently so load animations are in the
  // clip. A goto failure aborts the window early; the first error wins.
  try {
    recorder.pipe(
      new Writable({
        write (chunk, _encoding, callback) {
          chunks.push(Buffer.from(chunk))
          callback()
        }
      })
    )
    navigation = Promise.resolve(onStarted?.()).catch(error => {
      captureError = error
      recordingWindow.abort()
    })
    await delay(duration, undefined, { signal: recordingWindow.signal }).catch(NOOP)
  } catch (error) {
    captureError = captureError || error
  } finally {
    await recorder.stop().catch(error => {
      captureError = captureError || error
    })
  }

  await navigation
  if (captureError) throw captureError

  const buffer = Buffer.concat(chunks)
  if (buffer.length === 0) {
    throw new Error('No video data was captured. Increase `duration` or verify the page renders.')
  }

  if (outputPath) {
    await fs.writeFile(outputPath, buffer)
    debug('record.writeFile', { outputPath, bytes: buffer.length })
  }

  return buffer
}

module.exports = createCapture(runRecord, 'record')

'use strict'

const test = require('ava')

const { getOutputArgs, spawnFfmpeg, ENCODERS } = require('../src/recorder/ffmpeg')

const argsFor = opts => getOutputArgs({ width: 1280, height: 800, fps: 60, ...opts })

test('defaults to libx264 for mp4 and libvpx (vp8) for webm', t => {
  t.true(argsFor({ type: 'mp4' }).includes('libx264'))
  t.true(argsFor({ type: 'webm' }).includes('libvpx'))
})

test('normalizes `type` (case / leading dot) when picking the container', t => {
  for (const type of ['webm', 'WEBM', '.webm', ' webm ']) {
    t.true(argsFor({ type }).includes('libvpx'), `expected webm for ${JSON.stringify(type)}`)
  }
  t.true(argsFor({ type: '.mp4' }).includes('libx264'))
})

test('encoder opt selects the requested codec', t => {
  t.true(argsFor({ type: 'mp4', encoder: 'av1' }).includes('libsvtav1'))
  t.true(argsFor({ type: 'mp4', encoder: 'h264-medium' }).join(' ').includes('-preset medium'))
  t.true(argsFor({ type: 'webm', encoder: 'vp9' }).includes('libvpx-vp9'))
})

test('an encoder incompatible with the container falls back to the container default', t => {
  // vp9 only muxes into webm; requesting it for mp4 must not produce a webm codec.
  t.true(argsFor({ type: 'mp4', encoder: 'vp9' }).includes('libx264'))
  // h264 for webm falls back to vp8.
  t.true(argsFor({ type: 'webm', encoder: 'h264-medium' }).includes('libvpx'))
})

test('an unknown encoder falls back to the container default', t => {
  t.true(argsFor({ type: 'mp4', encoder: 'nope' }).includes('libx264'))
})

test('mp4 output is fragmented so it can stream to stdout', t => {
  const args = argsFor({ type: 'mp4' }).join(' ')
  t.true(args.includes('+frag_keyframe+empty_moov'))
  t.true(args.endsWith('pipe:1'))
})

test('exports the encoder profile names', t => {
  t.true(ENCODERS.includes('h264-ultrafast'))
  t.true(ENCODERS.includes('vp8'))
  t.true(ENCODERS.includes('av1'))
})

test('spawnFfmpeg kills the process and rejects when it exceeds the timeout', async t => {
  // `sleep` stands in for a hung encoder that never exits on its own.
  const { output } = spawnFfmpeg({ ffmpegPath: 'sleep', args: ['10'], timeout: 100 })
  await t.throwsAsync(() => output, { message: /did not finish within 100ms/ })
})

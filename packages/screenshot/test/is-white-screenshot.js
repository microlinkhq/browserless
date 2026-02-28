'use strict'

const test = require('ava')
const { readFile } = require('fs/promises')

const isWhite = require('../src/is-white-screenshot')

test('true', async t => {
  t.true(await isWhite(await readFile('./test/fixtures/white-5k.jpg')))
  t.true(await isWhite(await readFile('./test/fixtures/white-5k.png')))
})

test('false', async t => {
  t.false(await isWhite(await readFile('./test/fixtures/no-white-5k.jpg')))
  t.false(await isWhite(await readFile('./test/fixtures/no-white-5k.png')))
})

test('sampling algorithm correctly samples ~25% of pixels', async t => {
  const width = 5000
  const height = 5000
  const totalPixels = width * height
  const sampledPixels =
    Math.ceil(width / isWhite.SAMPLE_STEP_SIZE) * Math.ceil(height / isWhite.SAMPLE_STEP_SIZE)
  const percentageChecked = (sampledPixels / totalPixels) * 100

  t.true(
    percentageChecked >= 20 && percentageChecked <= 30,
    `Expected to check ~25% of pixels, but checked ${percentageChecked.toFixed(
      2
    )}% (${sampledPixels}/${totalPixels})`
  )
})

test('sampling skips non-grid pixels', t => {
  const width = 4
  const height = 4
  const channels = 4
  const data = Buffer.alloc(width * height * channels, 253)

  // (1, 1) is not sampled when step size is 2.
  const unsampledOffset = (1 * width + 1) * channels
  data[unsampledOffset] = 0

  t.true(isWhite.isWhiteSampledImage(data, { width, height, channels }))
})

test('sampling detects differences on sampled grid pixels', t => {
  const width = 4
  const height = 4
  const channels = 4
  const data = Buffer.alloc(width * height * channels, 253)

  // (2, 2) is sampled when step size is 2.
  const sampledOffset = (2 * width + 2) * channels
  data[sampledOffset] = 0

  t.false(isWhite.isWhiteSampledImage(data, { width, height, channels }))
})

test('sampling tolerates tiny near-white channel variance', t => {
  const width = 4
  const height = 4
  const channels = 4
  const data = Buffer.alloc(width * height * channels, 253)

  // Sampled pixel with +1 blue difference should still be treated as white.
  const sampledOffset = (2 * width + 2) * channels
  data[sampledOffset + 2] = 254

  t.true(isWhite.isWhiteSampledImage(data, { width, height, channels }))
})

test('handles memory errors gracefully on very large images', async t => {
  const { createCanvas } = require('canvas')

  const width = 10000
  const height = 10000
  const canvas = createCanvas(width, height)
  const ctx = canvas.getContext('2d')

  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  const largeImageBuffer = canvas.toBuffer('image/jpeg', { quality: 0.9 })
  const result = await isWhite(largeImageBuffer)
  t.is(typeof result, 'boolean', 'Should return a boolean, not throw an error')
})

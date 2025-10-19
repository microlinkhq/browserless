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
  // This test validates that the isWhiteScreenshot implementation actually samples
  // approximately 25% of pixels, not just that the math formula is correct.
  // It tracks how many pixels are actually checked by the implementation.

  const { Jimp } = require('jimp')

  // Use an existing white image from test fixtures
  const imageBuffer = await readFile('./test/fixtures/white-5k.png')

  // Monkey-patch getPixelColor to count how many times it's called
  const originalFromBuffer = Jimp.fromBuffer
  let pixelCheckCount = 0

  Jimp.fromBuffer = async function (buffer, options) {
    const image = await originalFromBuffer.call(this, buffer, options)
    const originalGetPixelColor = image.getPixelColor.bind(image)

    image.getPixelColor = function (x, y) {
      pixelCheckCount++
      return originalGetPixelColor(x, y)
    }

    return image
  }

  const isWhite = require('../src/is-white-screenshot')

  try {
    await isWhite(imageBuffer)

    // For a 5000x5000 image (25,000,000 pixels), should check ~6,250,000 pixels (25%)
    // With the buggy implementation, it checks only ~1,562,500 pixels (6.25%)
    const totalPixels = 5000 * 5000
    const percentageChecked = (pixelCheckCount / totalPixels) * 100

    t.true(
      percentageChecked >= 10 && percentageChecked <= 30,
      `Expected to check ~25% of pixels (at least 10% with early exits), but checked ${percentageChecked.toFixed(
        2
      )}% (${pixelCheckCount}/${totalPixels})`
    )
  } finally {
    // Restore original
    Jimp.fromBuffer = originalFromBuffer
  }
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

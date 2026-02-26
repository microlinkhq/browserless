'use strict'

const test = require('ava')
const { readFile } = require('fs/promises')

const { Jimp } = require('jimp')

process.env.BROWSERLESS_SCREENSHOT_DISABLE_WORKER = '1'
const isWhite = require('../src/is-white-screenshot')

const createJimpSpy = () => {
  const originalFromBuffer = Jimp.fromBuffer
  const spy = { callCount: 0 }

  const wrappedFromBuffer = async function (buffer, options) {
    const image = await originalFromBuffer.call(this, buffer, options)
    const originalGetPixelColor = image.getPixelColor.bind(image)

    image.getPixelColor = function (x, y) {
      spy.callCount++
      return originalGetPixelColor(x, y)
    }

    return image
  }

  Jimp.fromBuffer = wrappedFromBuffer

  return {
    spy,
    restore: () => {
      Jimp.fromBuffer = originalFromBuffer
    }
  }
}

test('true', async t => {
  t.true(await isWhite(await readFile('./test/fixtures/white-5k.jpg')))
  t.true(await isWhite(await readFile('./test/fixtures/white-5k.png')))
})

test('false', async t => {
  t.false(await isWhite(await readFile('./test/fixtures/no-white-5k.jpg')))
  t.false(await isWhite(await readFile('./test/fixtures/no-white-5k.png')))
})

test('sampling algorithm correctly samples ~25% of pixels', async t => {
  const imageBuffer = await readFile('./test/fixtures/white-5k.png')
  const tempImage = await Jimp.fromBuffer(imageBuffer)
  const totalPixels = tempImage.bitmap.width * tempImage.bitmap.height
  const { spy, restore } = createJimpSpy()

  await isWhite(imageBuffer)
  restore()

  const percentageChecked = (spy.callCount / totalPixels) * 100

  t.true(
    percentageChecked >= 20 && percentageChecked <= 30,
    `Expected to check ~25% of pixels, but checked ${percentageChecked.toFixed(2)}% (${
      spy.callCount
    }/${totalPixels})`
  )
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

'use strict'

const { Jimp } = require('jimp')

module.exports = async uint8array => {
  const image = await Jimp.fromBuffer(Buffer.from(uint8array))
  const firstPixel = image.getPixelColor(0, 0)
  const height = image.bitmap.height
  const width = image.bitmap.width

  const samplePercentage = 0.25 // Sample 25% of the image
  const sampleSize = Math.floor(width * height * samplePercentage) // Calculate sample size based on percentage
  const stepSize = Math.max(1, Math.floor((width * height) / sampleSize)) // Calculate step size based on sample size

  for (let i = 0; i < height; i += stepSize) {
    for (let j = 0; j < width; j += stepSize) {
      if (firstPixel !== image.getPixelColor(j, i)) return false
    }
  }

  return true
}

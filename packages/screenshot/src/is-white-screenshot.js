'use strict'

const jimp = require('jimp')

module.exports = async buffer => {
  const image = await jimp.read(buffer)
  const firstPixel = image.getPixelColor(0, 0)
  const height = image.getHeight()
  const width = image.getWidth()

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

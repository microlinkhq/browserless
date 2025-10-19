'use strict'

const { Jimp } = require('jimp')

module.exports = async uint8array => {
  const image = await Jimp.fromBuffer(Buffer.from(uint8array))
  const firstPixel = image.getPixelColor(0, 0)
  const height = image.bitmap.height
  const width = image.bitmap.width

  // For 2D grid sampling, calculate stepSize to achieve approximately the target sample percentage.
  // When sampling every 'stepSize' pixels in both dimensions, actual samples = (height/stepSize) * (width/stepSize).
  // To achieve samplePercentage, we need: (h*w)/(stepSize²) ≈ samplePercentage*(h*w)
  // Therefore: stepSize ≈ sqrt(1 / samplePercentage)
  const samplePercentage = 0.25 // Sample ~25% of the image
  const stepSize = Math.max(1, Math.ceil(Math.sqrt(1 / samplePercentage)))

  for (let i = 0; i < height; i += stepSize) {
    for (let j = 0; j < width; j += stepSize) {
      if (firstPixel !== image.getPixelColor(j, i)) return false
    }
  }

  return true
}

'use strict'

const jimp = require('jimp')

module.exports = async buffer => {
  const image = await jimp.read(buffer)
  const height = image.getHeight()
  const width = image.getWidth()

  const firstPixel = image.getPixelColor(0, 0)

  for (let i = 0; i < height; i++) {
    for (let j = 0; j < width; j++) {
      if (firstPixel !== image.getPixelColor(j, i)) return false
    }
  }

  return true
}

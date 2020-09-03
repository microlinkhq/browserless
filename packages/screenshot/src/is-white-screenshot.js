'use strict'

const jimp = require('jimp')

module.exports = async buffer => {
  const image = await jimp.read(buffer)
  const firstPixel = image.getPixelColor(0, 0)
  
  for (let i = 0; i < image.getHeight(); i++) {
    for (let j = 0; j < image.getWidth(); j++) {
      if (firstPixel !== image.getPixelColor(j, i)) return false
    }
  }

  return true
}

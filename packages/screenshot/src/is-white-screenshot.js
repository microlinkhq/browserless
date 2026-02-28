'use strict'

const sharp = require('sharp')

const SAMPLE_PERCENTAGE = 0.25
const SAMPLE_STEP_SIZE = Math.max(1, Math.ceil(Math.sqrt(1 / SAMPLE_PERCENTAGE)))

const isUniformSampledImage = (data, { width, height, channels }) => {
  if (!width || !height || !channels || data.length < channels) return false

  for (let y = 0; y < height; y += SAMPLE_STEP_SIZE) {
    const rowOffset = y * width * channels

    for (let x = 0; x < width; x += SAMPLE_STEP_SIZE) {
      const pixelOffset = rowOffset + x * channels

      for (let channel = 0; channel < channels; channel++) {
        if (data[pixelOffset + channel] !== data[channel]) return false
      }
    }
  }

  return true
}

module.exports = async uint8array => {
  const input = Buffer.isBuffer(uint8array) ? uint8array : Buffer.from(uint8array)
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return isUniformSampledImage(data, info)
}

module.exports.SAMPLE_PERCENTAGE = SAMPLE_PERCENTAGE
module.exports.SAMPLE_STEP_SIZE = SAMPLE_STEP_SIZE
module.exports.isUniformSampledImage = isUniformSampledImage

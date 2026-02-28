'use strict'

const sharp = require('sharp')

const SAMPLE_PERCENTAGE = 0.25
const SAMPLE_STEP_SIZE = Math.max(1, Math.ceil(Math.sqrt(1 / SAMPLE_PERCENTAGE)))
const WHITE_PIXEL_THRESHOLD = 245
const WHITE_COLOR_VARIANCE_TOLERANCE = 8

const blendOnWhite = (channel, alpha) => (channel * alpha + 255 * (255 - alpha)) / 255

const isWhiteSampledImage = (data, { width, height, channels }) => {
  if (!width || !height || !channels || data.length < channels) return false

  let minR = 255
  let minG = 255
  let minB = 255
  let maxR = 0
  let maxG = 0
  let maxB = 0

  for (let y = 0; y < height; y += SAMPLE_STEP_SIZE) {
    const rowOffset = y * width * channels

    for (let x = 0; x < width; x += SAMPLE_STEP_SIZE) {
      const pixelOffset = rowOffset + x * channels
      const a = channels > 3 ? data[pixelOffset + 3] : 255
      const r = blendOnWhite(data[pixelOffset], a)
      const g = blendOnWhite(data[pixelOffset + 1], a)
      const b = blendOnWhite(data[pixelOffset + 2], a)

      if (r < WHITE_PIXEL_THRESHOLD || g < WHITE_PIXEL_THRESHOLD || b < WHITE_PIXEL_THRESHOLD) {
        return false
      }

      if (r < minR) minR = r
      if (g < minG) minG = g
      if (b < minB) minB = b
      if (r > maxR) maxR = r
      if (g > maxG) maxG = g
      if (b > maxB) maxB = b
    }
  }

  return (
    maxR - minR <= WHITE_COLOR_VARIANCE_TOLERANCE &&
    maxG - minG <= WHITE_COLOR_VARIANCE_TOLERANCE &&
    maxB - minB <= WHITE_COLOR_VARIANCE_TOLERANCE
  )
}

module.exports = async uint8array => {
  const input = Buffer.isBuffer(uint8array) ? uint8array : Buffer.from(uint8array)
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  return isWhiteSampledImage(data, info)
}

module.exports.SAMPLE_PERCENTAGE = SAMPLE_PERCENTAGE
module.exports.SAMPLE_STEP_SIZE = SAMPLE_STEP_SIZE
module.exports.WHITE_PIXEL_THRESHOLD = WHITE_PIXEL_THRESHOLD
module.exports.WHITE_COLOR_VARIANCE_TOLERANCE = WHITE_COLOR_VARIANCE_TOLERANCE
module.exports.blendOnWhite = blendOnWhite
module.exports.isWhiteSampledImage = isWhiteSampledImage

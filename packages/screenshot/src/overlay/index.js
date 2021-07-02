'use strict'

const svgGradient = require('svg-gradient')
const isHttpUrl = require('is-url-http')
const sharp = require('sharp')
const path = require('path')
const got = require('got')

const toPx = str => `${str}px`

const toPercentage = input => {
  if (typeof input === 'number') return input
  if (input.includes('%')) return input.replace('%', '') / 100
  return input
}

const getBackground = async (bg = 'transparent', { margin = 0.2, viewport }) => {
  if (isHttpUrl(bg)) return got(bg).buffer()

  if (!bg.includes('gradient')) {
    bg = `linear-gradient(45deg, ${bg} 0%, ${bg} 100%)`
  }

  const { width, height, deviceScaleFactor = 1 } = viewport

  const totalWidth = width * deviceScaleFactor
  const totalHeight = height * deviceScaleFactor
  const marginPercentage = toPercentage(margin)

  const overlayViewport = {
    width: toPx(totalWidth + (totalWidth * marginPercentage) / 2),
    height: toPx(totalHeight + totalHeight * marginPercentage)
  }

  return Buffer.from(svgGradient(bg, overlayViewport))
}

const BROWSER_THEMES = {
  dark: path.resolve(__dirname, 'dark.png'),
  light: path.resolve(__dirname, 'light.png')
}

module.exports = async (screenshot, { browser: theme, background, margin, path, viewport }) => {
  const browserOverlay = BROWSER_THEMES[theme]

  const inputs = browserOverlay
    ? [{ input: browserOverlay }, { input: screenshot }]
    : [{ input: screenshot }]

  const bg = await getBackground(background, { margin, viewport })
  const image = sharp(bg).composite(inputs)

  return path ? image.toFile(path) : image.toBuffer()
}

'use strict'

const svgGradient = require('svg-gradient')
const isHttpUrl = require('is-url-http')
const sharp = require('sharp')
const path = require('path')
const got = require('got')

const createSvgBackground = css => svgGradient(css, { width: '2776px', height: '1910px' })

const getBackground = async (bg = 'transparent') => {
  if (isHttpUrl(bg)) return got(bg).buffer()

  if (!bg.includes('gradient')) {
    bg = `linear-gradient(45deg, ${bg} 0%, ${bg} 100%)`
  }

  return Buffer.from(createSvgBackground(bg))
}

const BROWSER_THEMES = {
  dark: path.resolve(__dirname, 'dark.png'),
  light: path.resolve(__dirname, 'light.png')
}

module.exports = async (screenshot, { browser: theme, background, path }) => {
  const browserOverlay = BROWSER_THEMES[theme]

  const inputs = browserOverlay
    ? [{ input: browserOverlay }, { input: screenshot }]
    : [{ input: screenshot }]

  const bg = await getBackground(background)
  const image = sharp(bg).composite(inputs)

  return path ? image.toFile(path) : image.toBuffer()
}

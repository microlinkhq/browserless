'use strict'

const svgGradient = require('svg-gradient')
const isHttpUrl = require('is-url-http')
const sharp = require('sharp')
const path = require('path')
const got = require('got')

const createPreparePage = require('./prepare')

const BROWSER_THEMES = {
  dark: path.resolve(__dirname, 'browser/dark.png'),
  light: path.resolve(__dirname, 'browser/light.png')
}

const getBackground = async (bg = 'transparent') => {
  if (isHttpUrl(bg)) return got(bg).buffer()

  if (!bg.includes('gradient')) {
    bg = `linear-gradient(45deg, ${bg} 0%, ${bg} 100%)`
  }

  return Buffer.from(createSvgBackground(bg))
}

const createSvgBackground = css => svgGradient(css, { width: '2776px', height: '1910px' })

module.exports = gotoOpts => {
  const preparePage = createPreparePage(gotoOpts)

  return page => async (url, { type = 'png', overlay = {}, ...opts } = {}) => {
    const screenshotOpts = {
      ...opts,
      ...(await preparePage(page, url, { overlay, ...opts })),
      type
    }

    const screenshot = await page.screenshot(screenshotOpts)

    if (Object.keys(overlay).length === 0) return screenshot

    const { browser: theme, background } = overlay
    const browserOverlay = BROWSER_THEMES[theme]

    const inputs = browserOverlay
      ? [{ input: browserOverlay }, { input: screenshot }]
      : [{ input: screenshot }]

    const image = sharp(await getBackground(background)).composite(inputs)

    return opts.path ? image.toFile(opts.path) : image.toBuffer()
  }
}

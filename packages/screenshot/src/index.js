'use strict'

const svgGradient = require('svg-gradient')
const isHttpUrl = require('is-url-http')
const sharp = require('sharp')
const path = require('path')
const got = require('got')

const createPreparePage = require('./prepare')

const browserOverlay = ['safari-light', 'safari-dark'].reduce(
  (acc, key) => ({
    ...acc,
    [key]: path.resolve(__dirname, `browser/${key}.png`)
  }),
  {}
)

const getBackground = async (bg = 'transparent') => {
  if (isHttpUrl(bg)) {
    const { body } = await got(bg, { encoding: null })
    return body
  }

  if (!bg.includes('gradient')) {
    bg = `linear-gradient(45deg, ${bg} 0%, ${bg} 100%)`
  }

  return Buffer.from(createSvgBackground(bg))
}

const createSvgBackground = css => svgGradient(css, { width: '1388px', height: '955px' })

module.exports = gotoOpts => {
  const preparePage = createPreparePage(gotoOpts)
  return page => async (
    url,
    { overlay = {}, type = 'png', direction = 'vertical', ...opts } = {}
  ) => {
    await preparePage(page, url, { overlay, ...opts })
    const screenshot = await page.screenshot({ ...opts, type })

    if (!overlay) return screenshot

    const { browser: browserSkin, background } = overlay
    let image = await sharp(await getBackground(background))
    let inputs = [{ input: screenshot }]

    if (browserSkin) {
      const input = browserOverlay[browserSkin]
      if (input) inputs = [{ input }].concat(inputs)
    }

    image = await image.composite(inputs)
    return opts.path ? image.toFile(opts.path) : image.toBuffer()
  }
}

'use strict'

const mergeImg = require('merge-img')
const { promisify } = require('util')
const jimp = require('jimp')

const pageDown = async page => {
  const isEnd = await page.evaluate(() => {
    window.scrollBy(0, window.innerHeight)
    return window.scrollY >= document.body.clientHeight - window.innerHeight
  })

  return isEnd
}

const toBuffer = (image, mime = jimp.AUTO) =>
  promisify(image.getBuffer.bind(image))(mime)

module.exports = async (page, { direction, ...opts }) => {
  const { pagesCount, extraPixels, viewport } = await page.evaluate(() => {
    window.scrollTo(0, 0)
    return {
      pagesCount: Math.ceil(document.body.clientHeight / window.innerHeight),
      extraPixels: document.body.clientHeight % window.innerHeight,
      viewport: { height: window.innerHeight, width: window.innerWidth }
    }
  })

  if (pagesCount === 1) return page.screenshot(opts)

  const images = []

  for (let index = 0; index < pagesCount; index++) {
    // if (delay) await page.waitFor(delay)
    const image = await page.screenshot({ opts })
    await pageDown(page)
    images.push(image)
  }

  // crop last image extra pixels
  const cropped = await jimp
    .read(images.pop())
    .then(image =>
      image.crop(0, viewport.height - extraPixels, viewport.width, extraPixels)
    )
    .then(toBuffer)

  images.push(cropped)

  const fullPageImage = await mergeImg(images, {
    direction: direction === 'vertical'
  })
  return toBuffer(fullPageImage, jimp.AUTO)
}

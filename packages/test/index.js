'use strict'

const { imgDiff } = require('img-diff-js')
const existsFile = require('exists-file')
const { copy } = require('fs-extra')
const { words } = require('lodash')
const temp = require('temperment')
const pdf = require('pdf-parse')
const path = require('path')
const test = require('ava')

const looksSame = async (actualFilename, expectedFilename) =>
  imgDiff({
    actualFilename,
    expectedFilename
    // options: {
    //   threshold: 0.8
    // }
  })

const imageComparison = async (t, expectedFilename, filename) => {
  const actualFilename = path.resolve(__dirname, `snapshots/${filename}`)
  if (!(await existsFile(actualFilename))) {
    await copy(expectedFilename, actualFilename)
    return true
  }
  return looksSame(expectedFilename, actualFilename)
}
module.exports = createBrowserless => {
  test('.html', async t => {
    const browserless = createBrowserless()
    const html = await browserless.html('https://example.com')
    t.snapshot(words(html))
  })

  test('.screenshot (png)', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot('http://example.com', { path: filepath })

    const { imagesAreSame, diffCount } = await imageComparison(t, filepath, 'example.png')
    t.true(imagesAreSame, `images are different by ${diffCount} differential pixels`)
  })

  test('.screenshot (jpeg)', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'jpeg' })
    await browserless.screenshot('http://example.com', { type: 'jpeg', path: filepath })
    const { imagesAreSame, diffCount } = await imageComparison(t, filepath, 'example.jpeg')
    t.true(imagesAreSame, `images are different by ${diffCount} differential pixels`)
  })

  test('.screenshot with device emulation', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot('http://example.com', { device: 'iPhone 6', path: filepath })
    const { imagesAreSame, diffCount } = await imageComparison(t, filepath, 'iphone.png')
    t.true(imagesAreSame, `images are different by ${diffCount} differential pixels`)
  })

  test('.pdf', async t => {
    const browserless = createBrowserless()
    const buffer = await browserless.pdf('http://example.com')
    const data = await pdf(buffer)
    t.snapshot(words(data.text))
  })
}

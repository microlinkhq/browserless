'use strict'

const { imgDiff } = require('img-diff-js')
const existsFile = require('exists-file')
const { copy } = require('fs-extra')
const temp = require('temperment')
const pdf = require('pdf-parse')
const path = require('path')
const test = require('ava')

const looksSame = async (actualFilename, expectedFilename) => {
  const { imagesAreSame } = await imgDiff({ actualFilename, expectedFilename })
  return imagesAreSame
}

const imageSnapshot = async (t, expectedFilename, filename) => {
  const actualFilename = path.resolve(__dirname, `snapshots/${filename}`)
  if (!(await existsFile(actualFilename))) {
    await copy(expectedFilename, actualFilename)
    return true
  }
  const isSame = await looksSame(expectedFilename, actualFilename)
  return isSame
}
module.exports = createBrowserless => {
  test('.html', async t => {
    const browserless = createBrowserless()
    const html = await browserless.html('https://example.com')
    t.snapshot(html)
  })

  test('.screenshot (png)', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot('http://example.com', { path: filepath })
    t.true(await imageSnapshot(t, filepath, 'example.png'))
  })

  test('.screenshot (jpeg)', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'jpeg' })
    await browserless.screenshot('http://example.com', { type: 'jpeg', path: filepath })
    t.true(await imageSnapshot(t, filepath, 'example.jpeg'))
  })

  test('.screenshot with device emulation', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot('http://example.com', { device: 'iPhone 6', path: filepath })
    t.true(await imageSnapshot(t, filepath, 'iphone.png'))
  })

  test('.pdf', async t => {
    const browserless = createBrowserless()
    const buffer = await browserless.pdf('http://example.com')
    const data = await pdf(buffer)
    const text = data.text.trim().replace('Example\nDomain', 'Example Domain')
    t.snapshot(text)
  })
}

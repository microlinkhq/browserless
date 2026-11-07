'use strict'

const { imgDiff } = require('img-diff-js')
const { PDFParse } = require('pdf-parse')
const { onExit } = require('signal-exit')
const { copy } = require('fs-extra')
const temp = require('temperment')
const path = require('path')
const { default: test } = require('ava')
const fs = require('fs')

const { runServer } = require('.')

const PIXELS_DIFFERENCE = 100

const SNAPSHOTS_PLATFORM = 'linux'

const snapshotTest = process.platform === SNAPSHOTS_PLATFORM ? test : test.skip

const snapshotTitle = title => `${title} (${SNAPSHOTS_PLATFORM} only, snapshots are rendered there)`

const looksSame = async (actualFilename, expectedFilename) =>
  imgDiff({
    actualFilename,
    expectedFilename
  })

const imageComparison = async (t, expectedFilename, filename) => {
  const actualFilename = path.resolve(process.cwd(), `test/snapshots/${filename}`)
  if (!fs.existsSync(actualFilename)) {
    await copy(expectedFilename, actualFilename)
    return { diffCount: 0 }
  }
  return looksSame(expectedFilename, actualFilename)
}

const assertImagesMatch = async (t, filepath, filename) => {
  const { diffCount } = await imageComparison(t, filepath, filename)
  t.log(`${filename}: ${diffCount} differential pixels`)
  t.true(diffCount <= PIXELS_DIFFERENCE, `images are different by ${diffCount} differential pixels`)
}

const getUrl = (t, body = '<p>hello world</p>') =>
  runServer(t, ({ res }) => {
    res.setHeader('Content-Type', 'text/html')
    return res.end(`<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Document</title>
    </head>
    <body>
      ${body}
    </body>
    </html>`)
  })

module.exports = (browser, teardown = browser.close) => {
  onExit(teardown)

  test('.html', async t => {
    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t)
    const html = await browserless.html(url, {
      adblock: false
    })
    t.snapshot(html)
  })

  test('.text', async t => {
    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t)
    const text = await browserless.text(url)

    t.snapshot(text)
  })

  snapshotTest(snapshotTitle('.screenshot (png)'), async t => {
    const filepath = temp.file({
      extension: 'png'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t)
    await browserless.screenshot(url, {
      path: filepath
    })

    await assertImagesMatch(t, filepath, 'example.png')
  })

  snapshotTest(snapshotTitle('.screenshot (jpeg)'), async t => {
    const filepath = temp.file({
      extension: 'jpeg'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t)
    await browserless.screenshot(url, {
      type: 'jpeg',
      path: filepath
    })

    await assertImagesMatch(t, filepath, 'example.jpeg')
  })

  snapshotTest(snapshotTitle('.screenshot with device emulation'), async t => {
    const filepath = temp.file({
      extension: 'png'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t)
    await browserless.screenshot(url, {
      device: 'iPhone 6',
      path: filepath
    })

    await assertImagesMatch(t, filepath, 'iphone.png')
  })

  snapshotTest(snapshotTitle('.screenshot of a blank page differs from the snapshot'), async t => {
    const filepath = temp.file({
      extension: 'png'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t, '')
    await browserless.screenshot(url, {
      path: filepath
    })

    const { diffCount } = await looksSame(
      filepath,
      path.resolve(process.cwd(), 'test/snapshots/example.png')
    )
    t.log(`blank page: ${diffCount} differential pixels`)
    t.true(
      diffCount > PIXELS_DIFFERENCE,
      `a blank page is only ${diffCount} differential pixels away from the snapshot`
    )
  })

  test('.pdf', async t => {
    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const url = await getUrl(t)
    const buffer = await browserless.pdf(url)

    const parser = new PDFParse({ data: buffer })
    await parser.load()
    const data = await parser.getText()

    t.snapshot(data.text.trim())
  })
}

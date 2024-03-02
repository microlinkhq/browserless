'use strict'

const { imgDiff } = require('img-diff-js')
const { onExit } = require('signal-exit')
const { runServer } = require('./util')
const { copy } = require('fs-extra')
const temp = require('temperment')
const pdf = require('pdf-parse')
const path = require('path')
const test = require('ava')
const fs = require('fs')

const isCI = !!process.env.CI

const PIXELS_DIFFERENCE = isCI ? 50000 : 0

const looksSame = async (actualFilename, expectedFilename) =>
  imgDiff({
    actualFilename,
    expectedFilename
  })

const imageComparison = async (t, expectedFilename, filename) => {
  const actualFilename = path.resolve(process.cwd(), `test/snapshots/${filename}`)
  if (!fs.existsSync(actualFilename)) {
    await copy(expectedFilename, actualFilename)
    return true
  }
  return looksSame(expectedFilename, actualFilename)
}

const url = runServer(({ res }) => {
  res.setHeader('Content-Type', 'text/html')
  return res.end(`<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Document</title>
    </head>
    <body>
      <p>hello world</p>
    </body>
    </html>`)
})

module.exports = (browser, teardown = browser.close) => {
  onExit(teardown)

  test('.html', async t => {
    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const html = await browserless.html(await url, {
      adblock: false
    })
    t.snapshot(html)
  })

  test('.text', async t => {
    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const text = await browserless.text(await url)

    t.snapshot(text)
  })

  test('.screenshot (png)', async t => {
    const filepath = temp.file({
      extension: 'png'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    await browserless.screenshot(await url, {
      path: filepath
    })

    const { diffCount } = await imageComparison(t, filepath, 'example.png')

    t.true(
      diffCount <= PIXELS_DIFFERENCE,
      `images are different by ${diffCount} differential pixels`
    )
  })

  test('.screenshot (jpeg)', async t => {
    const filepath = temp.file({
      extension: 'jpeg'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    await browserless.screenshot(await url, {
      type: 'jpeg',
      path: filepath
    })

    const { diffCount } = await imageComparison(t, filepath, 'example.jpeg')

    t.true(
      diffCount <= PIXELS_DIFFERENCE,
      `images are different by ${diffCount} differential pixels`
    )
  })

  test('.screenshot with device emulation', async t => {
    const filepath = temp.file({
      extension: 'png'
    })

    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    await browserless.screenshot(await url, {
      device: 'iPhone 6',
      path: filepath
    })

    const { diffCount } = await imageComparison(t, filepath, 'iphone.png')

    t.true(
      diffCount <= PIXELS_DIFFERENCE,
      `images are different by ${diffCount} differential pixels`
    )
  })

  test('.pdf', async t => {
    const browserless = await browser.createContext()
    t.teardown(browserless.destroyContext)
    const buffer = await browserless.pdf(await url)

    const data = await pdf(buffer)

    t.snapshot(data.text.trim())
  })
}

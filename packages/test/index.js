'use strict'

const { imgDiff } = require('img-diff-js')
const existsFile = require('exists-file')
const listen = require('test-listen')
const onExit = require('signal-exit')
const { copy } = require('fs-extra')
const temp = require('temperment')
const { serve } = require('micri')
const pdf = require('pdf-parse')
const isCI = require('is-ci')
const path = require('path')
const test = require('ava')

const PIXELS_DIFFERENCE = isCI ? 50000 : 0

const looksSame = async (actualFilename, expectedFilename) =>
  imgDiff({
    actualFilename,
    expectedFilename
  })

const imageComparison = async (t, expectedFilename, filename) => {
  const actualFilename = path.resolve(process.cwd(), `test/snapshots/${filename}`)
  if (!(await existsFile(actualFilename))) {
    await copy(expectedFilename, actualFilename)
    return true
  }
  return looksSame(expectedFilename, actualFilename)
}

const getServerUrl = (() => {
  const server = serve(async (req, res) => {
    res.setHeader('Content-Type', 'text/html')
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Document</title>
    </head>
    <body>
      <p>hello world</p>
    </body>
    </html>`
  })

  const initializedServer = listen(server)
  return () => Promise.resolve(initializedServer)
})()

module.exports = (browserless, teardown = browserless.destroy) => {
  onExit(teardown)

  test('.html', async t => {
    const url = await getServerUrl()

    const html = await browserless.html(url, { adblock: false, animations: true })
    t.snapshot(html)
  })

  test('.text', async t => {
    const url = await getServerUrl()
    const text = await browserless.text(url)

    t.snapshot(text)
  })

  test('.screenshot (png)', async t => {
    const url = await getServerUrl()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot(url, { path: filepath })
    const { diffCount } = await imageComparison(t, filepath, 'example.png')

    t.true(
      diffCount <= PIXELS_DIFFERENCE,
      `images are different by ${diffCount} differential pixels`
    )
  })

  test('.screenshot (jpeg)', async t => {
    const url = await getServerUrl()
    const filepath = temp.file({ extension: 'jpeg' })
    await browserless.screenshot(url, { type: 'jpeg', path: filepath })
    const { diffCount } = await imageComparison(t, filepath, 'example.jpeg')

    t.true(
      diffCount <= PIXELS_DIFFERENCE,
      `images are different by ${diffCount} differential pixels`
    )
  })

  test('.screenshot with device emulation', async t => {
    const url = await getServerUrl()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot(url, { device: 'iPhone 6', path: filepath })
    const { diffCount } = await imageComparison(t, filepath, 'iphone.png')

    t.true(
      diffCount <= PIXELS_DIFFERENCE,
      `images are different by ${diffCount} differential pixels`
    )
  })

  test('.pdf', async t => {
    const url = await getServerUrl()
    const buffer = await browserless.pdf(url)
    const data = await pdf(buffer)

    t.snapshot(data.text.trim())
  })
}

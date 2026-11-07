'use strict'

const { imgDiff } = require('img-diff-js')
const { PDFParse } = require('pdf-parse')
const { onExit } = require('signal-exit')
const temp = require('temperment')
const { default: test } = require('ava')
const fs = require('fs')

const { runServer } = require('.')

const MIN_PAINTED_PIXELS = 100

const BODY = '<p>hello world</p>'

const BLANK_BODY = '<p style="color: white">hello world</p>'

const FILE_SIGNATURES = {
  png: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  jpeg: Buffer.from([0xff, 0xd8, 0xff])
}

const getUrl = (t, body = BODY) =>
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

const takeScreenshot = async (t, browserless, { body, type, ...opts }) => {
  const filepath = temp.file({ extension: type })
  const url = await getUrl(t, body)
  await browserless.screenshot(url, { type, path: filepath, ...opts })
  return filepath
}

const assertScreenshot = async (t, browser, { type, width, height, ...opts }) => {
  const browserless = await browser.createContext()
  t.teardown(browserless.destroyContext)

  const filepath = await takeScreenshot(t, browserless, { type, ...opts })
  const blankFilepath = await takeScreenshot(t, browserless, {
    type,
    ...opts,
    body: BLANK_BODY,
    waitUntil: 'load'
  })

  const signature = FILE_SIGNATURES[type]
  t.true(
    fs.readFileSync(filepath).subarray(0, signature.length).equals(signature),
    `screenshot is not a ${type} file`
  )

  const diff = await imgDiff({ actualFilename: filepath, expectedFilename: blankFilepath })
  t.is(diff.width, width)
  t.is(diff.height, height)
  t.log(`${diff.diffCount} pixels painted over a blank page`)
  t.true(
    diff.diffCount >= MIN_PAINTED_PIXELS,
    `only ${diff.diffCount} pixels differ from a blank page, the content was not painted`
  )
}

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

  test('.screenshot (png)', t =>
    assertScreenshot(t, browser, { type: 'png', width: 2560, height: 1600 }))

  test('.screenshot (jpeg)', t =>
    assertScreenshot(t, browser, { type: 'jpeg', width: 2560, height: 1600 }))

  test('.screenshot with device emulation', t =>
    assertScreenshot(t, browser, {
      type: 'png',
      device: 'iPhone 6',
      width: 750,
      height: 1334
    }))

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

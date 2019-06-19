'use strict'

const { imgDiff } = require('img-diff-js')
const temp = require('temperment')
const pdf = require('pdf-parse')
const isCI = require('is-ci')
const path = require('path')
const test = require('ava')

const looksSame = async (actual, expected) => {
  const diff = await imgDiff({
    actualFilename: actual,
    expectedFilename: expected
  })
  return diff.imagesAreSame
}

module.exports = createBrowserless => {
  test('.html', async t => {
    const browserless = createBrowserless()
    const html = await browserless.html('https://example.com')
    t.true(html.includes('DOCTYPE'))
  })
  ;(isCI ? test.skip : test)('.screenshot (png)', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot('http://example.com', {
      path: filepath
    })

    t.true(await looksSame(filepath, path.resolve(__dirname, 'fixtures/example.png')))
  })
  ;(isCI ? test.skip : test)('.screenshot (jpeg)', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'jpeg' })
    await browserless.screenshot('http://example.com', {
      type: 'jpeg',
      path: filepath
    })

    t.true(await looksSame(filepath, path.resolve(__dirname, 'fixtures/example.jpeg')))
  })
  ;(isCI ? test.skip : test)('devices', async t => {
    const browserless = createBrowserless()
    const filepath = temp.file({ extension: 'png' })
    await browserless.screenshot('http://example.com', {
      device: 'iPhone 6',
      path: filepath
    })

    t.true(await looksSame(filepath, path.resolve(__dirname, 'fixtures/example-iphone.png')))
  })
  ;(isCI ? test.skip : test)('.pdf', async t => {
    const browserless = createBrowserless()
    const buffer = await browserless.pdf('http://example.com')
    const data = await pdf(buffer)
    t.snapshot(data.text.trim())
  })
}

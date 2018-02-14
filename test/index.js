'use strict'

const { readFileSync } = require('fs')
const isTravis = require('is-travis')
const should = require('should')
const path = require('path')

const browserless = require('..')({
  args: ['--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox']
})

const isBufferEqual = (buff1, buff2) => buff1.length === buff2.length

describe('browserless', () => {
  describe('.html', () => {
    it('get full HTML from a link', async () => {
      const html = await browserless.html('https://example.com')
      should(html.includes('DOCTYPE')).be.true()
    })
  })

  describe('.screenshot', () => {
    describe('format', () => {
      it('png', async () => {
        const tmpStream = await browserless.screenshot('http://example.com')

        const image = readFileSync(tmpStream.path)
        const fixture = readFileSync('test/example.png')

        tmpStream.cleanupSync()
        if (!isTravis) should(isBufferEqual(image, fixture)).be.true()
      })

      it('jpeg', async () => {
        const tmpStream = await browserless.screenshot('http://example.com', {
          type: 'jpeg'
        })

        const image = readFileSync(tmpStream.path)
        const fixture = readFileSync('test/example.jpeg')

        tmpStream.cleanupSync()
        if (!isTravis) should(isBufferEqual(image, fixture)).be.true()
      })
    })

    describe('devices', () => {
      it('iPhone 6', async () => {
        const tmpStream = await browserless.screenshot('http://example.com', {
          device: 'iPhone 6'
        })

        const image = readFileSync(tmpStream.path)
        const fixture = readFileSync('test/example-iphone.png')

        tmpStream.cleanupSync()
        if (!isTravis) should(isBufferEqual(image, fixture)).be.true()
      })
    })

    describe('.pdf', () => {
      it('get full PDF from an url', async () => {
        const tmpStream = await browserless.pdf('http://example.com')

        const pdf = readFileSync(tmpStream.path)
        const fixture = readFileSync('test/example.pdf')

        tmpStream.cleanupSync()

        should(path.extname(tmpStream.path)).be.equal('.pdf')
        if (!isTravis) should(isBufferEqual(pdf, fixture)).be.true()
      })
    })
  })
})

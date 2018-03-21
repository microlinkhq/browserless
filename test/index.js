'use strict'

const { promisify } = require('util')
const should = require('should')
const path = require('path')

const looksSame = promisify(require('looks-same'))

const browserless = require('../src')({
  args: ['--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox']
})

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
        const isEqual = looksSame('test/example.png', tmpStream.path)
        tmpStream.cleanupSync()
        await isEqual
      })

      it('jpeg', async () => {
        const tmpStream = await browserless.screenshot('http://example.com', {
          type: 'jpeg'
        })

        const isEqual = looksSame('test/example.jpeg', tmpStream.path)
        tmpStream.cleanupSync()
        await isEqual
      })
    })

    describe('devices', () => {
      it('iPhone 6', async () => {
        const tmpStream = await browserless.screenshot('http://example.com', {
          device: 'iPhone 6'
        })

        const isEqual = looksSame('test/example-iphone.png', tmpStream.path)
        tmpStream.cleanupSync()
        await isEqual
      })
    })

    describe('.pdf', () => {
      it('get full PDF from an url', async () => {
        const tmpStream = await browserless.pdf('http://example.com')
        should(path.extname(tmpStream.path)).be.equal('.pdf')
      })
    })
  })
})

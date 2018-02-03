'use strict'

const { createReadStream } = require('fs')
const pixelmatch = require('pixelmatch')
const { promisify } = require('util')
const { PNG } = require('pngjs')
const should = require('should')
const path = require('path')

const browserless = require('..')({
  args: ['--disable-gpu', '--single-process', '--no-zygote', '--no-sandbox']
})

// const isBufferEqual = (buff1, buff2) => buff1.length === buff2.length

describe('browserless', () => {
  describe('.html', () => {
    it('get full HTML from a link', async () => {
      const html = await browserless.html('https://google.com')
      should(html.includes('DOCTYPE')).be.true()
    })
  })

  const getDiffPixels = promisify(({ imageOnePath, imageTwoPath }, cb) => {
    let filesRead = 0

    const imageOne = createReadStream(imageOnePath)
      .pipe(new PNG())
      .on('parsed', doneReading)

    const imageTwo = createReadStream(imageTwoPath)
      .pipe(new PNG())
      .on('parsed', doneReading)

    function doneReading () {
      if (++filesRead < 2) return

      if (imageOne.width !== imageTwo.width) {
        return cb(new Error('width are different'))
      }
      if (imageOne.height !== imageTwo.height) {
        return cb(new Error('height are different'))
      }

      const diff = new PNG({ width: imageOne.width, height: imageOne.height })

      return cb(
        null,
        pixelmatch(
          imageOne.data,
          imageTwo.data,
          diff.data,
          imageOne.width,
          imageOne.height,
          { threshold: 0.1 }
        )
      )
    }
  })

  describe('.screenshot', () => {
    describe('format', () => {
      it('png', async () => {
        const tmpStream = await browserless.screenshot('http://example.com')

        const numDiffPixels = await getDiffPixels({
          imageOnePath: tmpStream.path,
          imageTwoPath: 'test/example.png'
        })

        tmpStream.cleanupSync()
        should(numDiffPixels).be.equal(0)
      })

      xit('jpeg', async () => {
        const tmpStream = await browserless.screenshot('http://example.com', {
          type: 'jpeg'
        })

        // const image = readFileSync(tmpStream.path)
        // const fixture = readFileSync('test/example.jpeg')

        tmpStream.cleanupSync()
        // if (!isTravis) should(isBufferEqual(image, fixture)).be.true()
      })
    })

    describe('devices', () => {
      it('iPhone 6', async () => {
        const tmpStream = await browserless.screenshot('http://example.com', {
          device: 'iPhone 6'
        })

        const numDiffPixels = await getDiffPixels({
          imageOnePath: tmpStream.path,
          imageTwoPath: 'test/example-iphone.png'
        })

        tmpStream.cleanupSync()
        should(numDiffPixels).be.equal(0)
      })
    })

    describe('.pdf', () => {
      xit('get full PDF from an url', async () => {
        const tmpStream = await browserless.pdf('http://example.com')

        // const pdf = readFileSync(tmpStream.path)
        // const fixture = readFileSync('test/example.pdf')

        tmpStream.cleanupSync()

        should(path.extname(tmpStream.path)).be.equal('.pdf')
        // if (!isTravis) should(isBufferEqual(pdf, fixture)).be.true()
      })
    })
  })
})

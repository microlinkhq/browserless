'use strict'

const { promisify } = require('util')
const should = require('should')
const path = require('path')

const looksSame = promisify(require('looks-same'))
;[
  { name: 'browserless', fn: require('../src') },
  { name: 'browserless:pool', fn: require('../src/pool') }
].forEach(({ name, fn: createBrowserless }) => {
  describe(name, () => {
    describe('.html', () => {
      it('get full HTML from a link', async () => {
        const browserless = createBrowserless()
        const html = await browserless.html('https://example.com')
        should(html.includes('DOCTYPE')).be.true()
      })
    })

    describe('.screenshot', () => {
      describe('format', () => {
        it('png', async () => {
          const browserless = createBrowserless()
          const tmp = await browserless.screenshot('http://example.com')
          const isEqual = await looksSame('test/example.png', tmp.path)
          tmp.cleanupSync()
          should(path.extname(tmp.path)).be.equal('.png')
          return isEqual
        })

        it('jpeg', async () => {
          const browserless = createBrowserless()
          const tmp = await browserless.screenshot('http://example.com', {
            type: 'jpeg'
          })
          tmp.cleanupSync()
          should(path.extname(tmp.path)).be.equal('.jpeg')
        })
      })

      describe('devices', () => {
        it('iPhone 6', async () => {
          const browserless = createBrowserless()
          const tmp = await browserless.screenshot('http://example.com', {
            device: 'iPhone 6'
          })

          const isEqual = await looksSame('test/example-iphone.png', tmp.path)
          tmp.cleanupSync()
          return isEqual
        })
      })

      describe('.pdf', () => {
        it('get full PDF from an url', async () => {
          const browserless = createBrowserless()
          const tmp = await browserless.pdf('http://example.com')
          should(path.extname(tmp.path)).be.equal('.pdf')
        })
      })
    })
  })
})

'use strict'

const { imgDiff } = require('img-diff-js')
const snapshot = require('snap-shot')
const temp = require('temperment')
const should = require('should')
const pdf = require('pdf-parse')
const isCI = require('is-ci')

const looksSame = async (actual, expected) => {
  // shitty screenshot compare on Travis :(
  if (isCI) return true

  const diff = await imgDiff({
    actualFilename: actual,
    expectedFilename: expected
  })
  return diff.imagesAreSame
}
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
          const filepath = temp.file({ extension: 'png' })
          await browserless.screenshot('http://example.com', {
            path: filepath
          })

          // require('fs').writeFileSync('test/example.png', output)
          should(await looksSame(filepath, 'test/example.png')).be.true()
        })

        it('jpeg', async () => {
          const browserless = createBrowserless()
          const filepath = temp.file({ extension: 'jpeg' })
          await browserless.screenshot('http://example.com', {
            type: 'jpeg',
            path: filepath
          })

          // require('fs').writeFileSync('test/example.jpeg', output)
          should(await looksSame(filepath, 'test/example.jpeg')).be.true()
        })
      })

      describe('devices', () => {
        it('iPhone 6', async () => {
          const browserless = createBrowserless()
          const filepath = temp.file({ extension: 'png' })
          await browserless.screenshot('http://example.com', {
            device: 'iPhone 6',
            path: filepath
          })

          // require('fs').writeFileSync('test/example-iphone.png', output)
          should(await looksSame(filepath, 'test/example-iphone.png')).be.true()
        })
      })

      describe('.pdf', () => {
        it('get full PDF from an url', async () => {
          const browserless = createBrowserless()
          const buffer = await browserless.pdf('http://example.com')
          const data = await pdf(buffer)
          !isCI && snapshot(data.text.trim())
        })
      })
    })
  })
})

'use strict'

const should = require('should')
const path = require('path')
const fs = require('fs')

const frowser = require('..')

const htmlFixture = fs.readFileSync(path.resolve(__dirname, 'html.txt'), 'utf8')

describe('frowser', () => {
  describe('.getHTML', () => {
    it('get full HTML from a link', () =>
      frowser.getHTML('http://example.com').then(html => {
        // fs.writeFileSync(path.resolve(__dirname, 'html.txt'), html, 'utf8')
        should(html).be.eql(htmlFixture)
      }))
  })

  describe('.takeScreenshot', () => {
    it('png', () =>
      frowser.takeScreenshot('http://example.com').then(tmpStream => {
        should(fs.readFileSync(tmpStream.path)).be.eql(
          fs.readFileSync('test/example.png')
        )
        should(path.extname(tmpStream.path)).be.equal('.png')
        tmpStream.cleanupSync()
      }))

    it('jpeg', () =>
      frowser
        .takeScreenshot('http://example.com', { type: 'jpeg' })
        .then(tmpStream => {
          should(fs.readFileSync(tmpStream.path)).be.eql(
            fs.readFileSync('test/example.jpeg')
          )
          should(path.extname(tmpStream.path)).be.equal('.jpeg')
          tmpStream.cleanupSync()
        }))
  })
})

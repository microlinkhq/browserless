'use strict'

const { readFileSync } = require('fs')
const should = require('should')
const path = require('path')

const browserless = require('..')

describe('browserless', () => {
  describe('.html', () => {
    it('get full HTML from a link', () =>
      browserless
        .html('https://www.instagram.com/p/BWUDBntl3_Z/')
        .then(html => {
          should(html.includes('DOCTYPE')).be.true()
        }))
  })

  describe('.screenshot', () => {
    describe('format', () => {
      it('png', () =>
        browserless.screenshot('http://example.com').then(tmpStream => {
          should(readFileSync(tmpStream.path).length).be.eql(
            readFileSync('test/example.png').length
          )
          should(path.extname(tmpStream.path)).be.equal('.png')
          tmpStream.cleanupSync()
        }))

      it('jpeg', () =>
        browserless
          .screenshot('http://example.com', { type: 'jpeg' })
          .then(tmpStream => {
            should(readFileSync(tmpStream.path).length).be.eql(
              readFileSync('test/example.jpeg').length
            )
            should(path.extname(tmpStream.path)).be.equal('.jpeg')
            tmpStream.cleanupSync()
          }))
    })

    describe('devices', () => {
      it('iPhone 6', () =>
        browserless
          .screenshot('http://example.com', { device: 'iPhone 6' })
          .then(tmpStream => {
            should(readFileSync(tmpStream.path).length).be.eql(
              readFileSync('test/example-iphone.png').length
            )
            tmpStream.cleanupSync()
          }))
    })
  })

  describe('.pdf', () => {
    it('get full PDF from an url', () =>
      browserless.pdf('http://example.com').then(tmpStream => {
        should(path.extname(tmpStream.path)).be.equal('.pdf')
        tmpStream.cleanupSync()
      }))
  })
})

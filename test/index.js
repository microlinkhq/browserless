'use strict'

const { readFileSync } = require('fs')
const isTravis = require('is-travis')
const should = require('should')
const path = require('path')

const browserless = require('..')

const areEqual = (image1, image2) => image1.length === image2.length

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
          const imageBuffer = readFileSync(tmpStream.path)
          const fixtureBuffer = readFileSync('test/example.png')
          const areImageEquals = areEqual(imageBuffer, fixtureBuffer)
          tmpStream.cleanupSync()
          should(isTravis ? true : areImageEquals).be.true()
        }))

      it('jpeg', () =>
        browserless
          .screenshot('http://example.com', { type: 'jpeg' })
          .then(tmpStream => {
            const imageBuffer = readFileSync(tmpStream.path)
            const fixtureBuffer = readFileSync('test/example.jpeg')
            const areImageEquals = areEqual(imageBuffer, fixtureBuffer)
            tmpStream.cleanupSync()
            should(isTravis ? true : areImageEquals).be.true()
          }))
    })

    describe('devices', () => {
      it('iPhone 6', () =>
        browserless
          .screenshot('http://example.com', { device: 'iPhone 6' })
          .then(tmpStream => {
            const imageBuffer = readFileSync(tmpStream.path)
            const fixtureBuffer = readFileSync('test/example-iphone.png')
            const areImageEquals = areEqual(imageBuffer, fixtureBuffer)
            tmpStream.cleanupSync()
            should(isTravis ? true : areImageEquals).be.true()
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

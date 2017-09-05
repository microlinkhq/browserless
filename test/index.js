'use strict'

const should = require('should')
const path = require('path')
const { readFileSync, writeFileSync } = require('fs')

const frowser = require('..')

describe('frowser', () => {
  describe('.html', () => {
    it('get full HTML from a link', () =>
      frowser.html('https://www.instagram.com/p/BWUDBntl3_Z/').then(html => {
        writeFileSync(path.resolve('test/example.html'), html, 'utf8')
        should(html).be.eql(readFileSync('test/example.html', 'utf8'))
      }))
  })

  describe('.screenshot', () => {
    describe('format', () => {
      it('png', () =>
        frowser.screenshot('http://example.com').then(tmpStream => {
          should(readFileSync(tmpStream.path)).be.eql(
            readFileSync('test/example.png')
          )
          should(path.extname(tmpStream.path)).be.equal('.png')
          tmpStream.cleanupSync()
        }))

      it('jpeg', () =>
        frowser
          .screenshot('http://example.com', { type: 'jpeg' })
          .then(tmpStream => {
            should(readFileSync(tmpStream.path)).be.eql(
              readFileSync('test/example.jpeg')
            )
            should(path.extname(tmpStream.path)).be.equal('.jpeg')
            tmpStream.cleanupSync()
          }))
    })

    describe('devices', () => {
      it('iPhone 6', () =>
        frowser
          .screenshot('http://example.com', { device: 'iPhone 6' })
          .then(tmpStream => {
            should(readFileSync(tmpStream.path)).be.eql(
              readFileSync('test/example-iphone.png')
            )
            tmpStream.cleanupSync()
          }))
    })
  })

  describe('.pdf', () => {
    it('get full PDF from an url', () =>
      frowser.pdf('http://example.com').then(tmpStream => {
        should(path.extname(tmpStream.path)).be.equal('.pdf')
        tmpStream.cleanupSync()
      }))
  })
})

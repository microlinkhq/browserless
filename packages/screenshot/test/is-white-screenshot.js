'use strict'

const test = require('ava')
const { readFile } = require('fs/promises')

const isWhite = require('../src/is-white-screenshot')

test('true', async t => {
  t.true(await isWhite(await readFile('./test/fixtures/white-5k.jpg')))
  t.true(await isWhite(await readFile('./test/fixtures/white-5k.png')))
})

test('false', async t => {
  t.false(await isWhite(await readFile('./test/fixtures/no-white-5k.jpg')))
  t.false(await isWhite(await readFile('./test/fixtures/no-white-5k.png')))
})

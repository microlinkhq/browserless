'use strict'

const { URL } = require('url')

const createBrowserless = require('..')
const browserless = createBrowserless()
const stringStream = require('string-to-stream')

const url = new URL(process.argv[2])
;(async () => {
  const text = await browserless.text(url.toString())
  const stream = stringStream(text)
  stream.pipe(process.stdout)
  stream.on('end', process.exit)
})()

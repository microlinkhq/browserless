'use strict'

const toBuffer = require('data-uri-to-buffer')

const lighthouse = require('../../lighthouse')

require('./main')(async url => {
  const metrics = await lighthouse(url)
  console.log(JSON.stringify(metrics, null, 2))
  const thumbnails = metrics['screenshot-thumbnails'].details.items.map(item => toBuffer(item.data))
  return { output: thumbnails, isImage: true }
})

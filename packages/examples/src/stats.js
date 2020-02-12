'use strict'

const toBuffer = require('data-uri-to-buffer')

const stats = require('../../stats')

require('./main')(async url => {
  const metrics = await stats(url)
  console.log(JSON.stringify(metrics, null, 2))
  const thumbnails = metrics['screenshot-thumbnails'].details.items.map(item => toBuffer(item.data))
  return { output: thumbnails, isImage: true }
})

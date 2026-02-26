'use strict'

const { parentPort } = require('worker_threads')

const analyze = require('./is-white-screenshot-analyze')

parentPort.on('message', async ({ id, uint8array }) => {
  try {
    const value = await analyze(uint8array)
    parentPort.postMessage({ id, value })
  } catch (error) {
    parentPort.postMessage({
      id,
      error: {
        message: error.message,
        name: error.name
      }
    })
  }
})

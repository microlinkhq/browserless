'use strict'

const path = require('path')

const analyze = require('./is-white-screenshot-analyze')

let worker
let workerDisabled = process.env.BROWSERLESS_SCREENSHOT_DISABLE_WORKER === '1'
let messageId = 0

const pending = new Map()

const rejectPending = error => {
  for (const { reject } of pending.values()) reject(error)
  pending.clear()
}

const getWorker = () => {
  if (workerDisabled) return
  if (worker) return worker

  try {
    const { Worker } = require('worker_threads')
    worker = new Worker(path.resolve(__dirname, './is-white-screenshot-worker.js'))
  } catch (_) {
    workerDisabled = true
    return
  }

  if (typeof worker.unref === 'function') worker.unref()

  worker.on('message', ({ id, value, error }) => {
    const resolver = pending.get(id)
    if (!resolver) return
    pending.delete(id)
    if (error) {
      const err = new Error(error.message)
      err.name = error.name || 'Error'
      return resolver.reject(err)
    }
    resolver.resolve(value)
  })

  worker.on('error', error => {
    rejectPending(error)
    workerDisabled = true
    worker = undefined
  })

  worker.on('exit', code => {
    if (code !== 0) {
      rejectPending(new Error(`is-white-screenshot worker exited with code ${code}`))
      workerDisabled = true
    }
    worker = undefined
  })

  return worker
}

module.exports = async uint8array => {
  const activeWorker = getWorker()
  if (!activeWorker) return analyze(uint8array)

  return new Promise((resolve, reject) => {
    const id = ++messageId
    pending.set(id, { resolve, reject })

    try {
      activeWorker.postMessage({ id, uint8array: Buffer.from(uint8array) })
    } catch (error) {
      pending.delete(id)
      resolve(analyze(uint8array))
    }
  })
}

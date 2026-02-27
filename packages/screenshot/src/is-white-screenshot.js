'use strict'

const path = require('path')
const { Worker } = require('worker_threads')

let worker
let messageId = 0

const pending = new Map()

const syncWorkerRef = instance => {
  if (worker !== instance) return
  if (typeof instance.ref !== 'function' || typeof instance.unref !== 'function') return
  if (pending.size > 0) instance.ref()
  else instance.unref()
}

const rejectPending = error => {
  for (const { reject } of pending.values()) reject(error)
  pending.clear()
}

const getWorker = () => {
  if (worker) return worker

  const instance = new Worker(path.resolve(__dirname, './is-white-screenshot-worker.js'))
  worker = instance

  syncWorkerRef(instance)

  instance.on('message', ({ id, value, error }) => {
    const resolver = pending.get(id)
    if (!resolver) return
    pending.delete(id)
    syncWorkerRef(instance)
    if (error) {
      const err = new Error(error.message)
      err.name = error.name || 'Error'
      return resolver.reject(err)
    }
    resolver.resolve(value)
  })

  instance.on('error', error => {
    if (worker === instance) {
      rejectPending(error)
      worker = undefined
    }
  })

  instance.on('exit', code => {
    if (worker === instance) {
      if (pending.size > 0) {
        rejectPending(new Error(`is-white-screenshot worker exited with code ${code}`))
      }
      worker = undefined
    }
  })

  return instance
}

module.exports = async uint8array => {
  return new Promise((resolve, reject) => {
    const activeWorker = getWorker()
    const id = ++messageId
    pending.set(id, { resolve, reject })
    syncWorkerRef(activeWorker)

    try {
      activeWorker.postMessage({ id, uint8array: Buffer.from(uint8array) })
    } catch (error) {
      pending.delete(id)
      syncWorkerRef(activeWorker)
      reject(error)
    }
  })
}

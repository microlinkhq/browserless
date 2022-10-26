'use strict'

const { workerData, parentPort } = require('node:worker_threads')
const { serializeError } = require('serialize-error')
const lighthouse = require('lighthouse')

const main = async ({ url, flags, config }) => {
  try {
    const { lhr, report } = await lighthouse(url, flags, config)
    const value = flags.output === 'json' ? lhr : report

    return {
      isFulfilled: true,
      isRejected: false,
      value
    }
  } catch (error) {
    return {
      isFulfilled: false,
      isRejected: true,
      reason: serializeError(error)
    }
  }
}

main(workerData).then(result => parentPort.postMessage(JSON.stringify(result)))

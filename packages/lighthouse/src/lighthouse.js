'use strict'

const lighthouse = require('lighthouse/core/index.cjs')
const { serializeError } = require('serialize-error')

module.exports = async ({ url, flags, config }) => {
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

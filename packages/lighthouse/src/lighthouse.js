'use strict'

const errors = require('@browserless/errors')
const lighthouse = require('lighthouse/core/index.cjs')

// Lighthouse instruments each phase with performance marks (via marky). When
// the browser context is torn down mid-run, lighthouse's teardown calls
// `performance.measure` for a phase whose start mark never fired, throwing a
// `SyntaxError: The "start lh:…" performance mark has not been set`. That
// message masks the real cause (a destroyed context), so it would otherwise
// escape the retry machinery as an opaque error. Map it back to a
// context-disconnected error to let `withPage` recreate the context and retry.
const isPerfMarkError = error =>
  error?.message?.endsWith('performance mark has not been set') ?? false

module.exports = async ({ url, config, flags, page }) => {
  try {
    const { lhr, report } = await lighthouse(url, flags, config, page)
    return config.settings.output === 'json' ? lhr : report
  } catch (error) {
    if (isPerfMarkError(error)) throw errors.contextDisconnected()
    throw error
  }
}

module.exports.isPerfMarkError = isPerfMarkError

'use strict'

// Navigation-tolerant readiness gate. Resolves once the page has been visually
// quiet — document height stable, every image decoded, `readyState` complete —
// for `quietMs`, bounded by `timeout`. Unlike a screenshot poll it takes no
// screenshots (which are expensive under software rendering, e.g. the GPU-less
// fleet's llvmpipe) and it survives a client-side navigation: when the
// execution context is destroyed mid-check the quiet window resets and polling
// continues instead of throwing (SPAs re-commit their own URL after load).

const { setTimeout: sleep } = require('node:timers/promises')
const { isContextDestroyed } = require('@browserless/errors')

// Evaluated in-page: a cheap snapshot of the paint/settle signals.
const snapshot = () => {
  const images = document.images
  let decoded = 0
  for (let i = 0; i < images.length; i++) {
    const img = images[i]
    if (img.complete && img.naturalWidth > 0) decoded++
  }
  return {
    height: document.documentElement.scrollHeight,
    images: images.length,
    decoded,
    complete: document.readyState === 'complete'
  }
}

const waitForReady = async (page, { timeout, quietMs = 600, poll = 150 } = {}) => {
  if (!Number.isFinite(timeout)) throw new TypeError('timeout must be a finite number')
  // The quiet window must fit within the budget with room to observe it, or the
  // gate could never satisfy its own requirement and would always time out.
  quietMs = Math.min(quietMs, Math.floor(timeout / 2))
  const deadline = Date.now() + timeout
  let lastHeight = -1
  let quietSince = 0
  let resets = 0
  let last = { height: 0, images: 0, decoded: 0, complete: false }

  while (Date.now() < deadline) {
    let snap
    try {
      snap = await page.evaluate(snapshot)
    } catch (error) {
      // Only a client-side navigation tearing down the execution context is
      // absorbed: reset the quiet window and keep polling. Any other evaluate
      // failure is a real error and surfaces instead of masquerading as a
      // timeout.
      if (!isContextDestroyed(error)) throw error
      resets++
      lastHeight = -1
      quietSince = 0
      await sleep(poll)
      continue
    }

    last = snap
    const imagesDecoded = snap.images === 0 || snap.decoded >= snap.images
    const quiet = snap.complete && imagesDecoded && snap.height === lastHeight

    if (quiet) {
      if (quietSince === 0) quietSince = Date.now()
      if (Date.now() - quietSince >= quietMs) return { ...snap, resets, timedOut: false }
    } else {
      quietSince = 0
      lastHeight = snap.height
    }

    await sleep(poll)
  }

  return { ...last, resets, timedOut: true }
}

module.exports = { waitForReady }

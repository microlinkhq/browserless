'use strict'

const DEFAULT_OPTS = {
  format: 'jpeg',
  quality: 80
}

module.exports = (page, opts) => {
  const cdp = page._client()
  let onFrame
  let hasFrameListener = false
  let stopped = false

  const ack = sessionId => cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})

  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    if (!metadata.timestamp || !onFrame) return ack(sessionId)

    let result
    try {
      result = onFrame(data, metadata)
    } catch {
      // Swallow like the async-rejection path below: a frame-callback error must
      // not propagate into puppeteer's CDP dispatch loop. Still ack so the
      // screencast stream cannot stall on a single bad frame.
      return ack(sessionId)
    }

    if (!result || typeof result.then !== 'function') return ack(sessionId)

    return (
      Promise.resolve(result)
        .catch(() => {})
        // The frame may settle after stop(); don't ack a torn-down session (a
        // stale ack could otherwise race a subsequent screencast on the same page).
        .then(() => stopped || ack(sessionId))
    )
  }

  const attachFrameListener = () => {
    if (hasFrameListener) return
    cdp.on('Page.screencastFrame', onScreencastFrame)
    hasFrameListener = true
  }

  const detachFrameListener = () => {
    if (!hasFrameListener) return
    cdp.off('Page.screencastFrame', onScreencastFrame)
    hasFrameListener = false
  }

  return {
    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
    start: () => {
      if (!onFrame) throw new Error('onFrame callback must be registered before calling start()')
      stopped = false
      attachFrameListener()
      return cdp.send('Page.startScreencast', { ...DEFAULT_OPTS, ...opts })
    },
    onFrame: fn => (onFrame = fn),
    stop: () => {
      stopped = true
      detachFrameListener()
      return cdp.send('Page.stopScreencast').catch(() => {})
    }
  }
}

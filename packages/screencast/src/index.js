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

  // Never ack a torn-down session: a stale ack could race a subsequent screencast
  // on the same page. `stopped` flips true when stop() runs — including a
  // reentrant stop() from inside onFrame, or an async frame settling after stop().
  const ackIfActive = sessionId => {
    if (!stopped) return ack(sessionId)
  }

  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    if (!metadata.timestamp || !onFrame) return ackIfActive(sessionId)

    let result
    try {
      result = onFrame(data, metadata)
    } catch {
      // A synchronous onFrame throw must not propagate into puppeteer's CDP
      // dispatch loop; still ack so the stream can't stall on one bad frame.
      return ackIfActive(sessionId)
    }

    // Common path: onFrame did nothing async (e.g. muxer.write applied no
    // backpressure). Ack synchronously — no Promise/microtask hop per frame.
    if (!result || typeof result.then !== 'function') return ackIfActive(sessionId)

    // Backpressure path: defer the ack until the frame is consumed.
    return Promise.resolve(result)
      .catch(() => {})
      .then(() => ackIfActive(sessionId))
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

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
  let generation = 0

  const ack = sessionId => cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})

  // Never ack a torn-down session: a stale ack could race a subsequent screencast
  // on the same page. `stopped` flips true when stop() runs; `generation` bumps
  // when start() or a main-frame restart opens a new session — including a
  // reentrant stop() from inside onFrame, or an async frame settling after stop()
  // / navigation.
  const ackIfActive = (sessionId, gen) => {
    if (!stopped && gen === generation) return ack(sessionId)
  }

  const onScreencastFrame = ({ data, metadata = {}, sessionId }) => {
    const gen = generation
    if (!onFrame) return ackIfActive(sessionId, gen)

    // CDP marks ScreencastFrameMetadata.timestamp as optional. Dropping those
    // frames made capture look empty under some GL/headless backends; fill a
    // wall-clock fallback (seconds, same unit as TimeSinceEpoch) instead.
    const frameMetadata =
      metadata.timestamp == null ? { ...metadata, timestamp: Date.now() / 1000 } : metadata

    let result
    try {
      result = onFrame(data, frameMetadata)
    } catch {
      // A synchronous onFrame throw must not propagate into puppeteer's CDP
      // dispatch loop; still ack so the stream can't stall on one bad frame.
      return ackIfActive(sessionId, gen)
    }

    // Common path: onFrame did nothing async (e.g. muxer.write applied no
    // backpressure). Ack synchronously — no Promise/microtask hop per frame.
    if (!result || typeof result.then !== 'function') return ackIfActive(sessionId, gen)

    // Backpressure path: defer the ack until the frame is consumed.
    return Promise.resolve(result)
      .catch(() => {})
      .then(() => ackIfActive(sessionId, gen))
  }

  const startScreencast = () => {
    generation++
    return cdp.send('Page.startScreencast', { ...DEFAULT_OPTS, ...opts })
  }

  // start() then goto/setContent is the documented capture shape. Navigation
  // swaps the renderer and the old screencast session goes silent — restart.
  const onMainFrameNavigated = ({ frame } = {}) => {
    if (stopped || (frame && frame.parentId)) return
    startScreencast().catch(() => {})
  }

  const attachFrameListener = () => {
    if (hasFrameListener) return
    cdp.on('Page.screencastFrame', onScreencastFrame)
    cdp.on('Page.frameNavigated', onMainFrameNavigated)
    hasFrameListener = true
  }

  const detachFrameListener = () => {
    if (!hasFrameListener) return
    cdp.off('Page.screencastFrame', onScreencastFrame)
    cdp.off('Page.frameNavigated', onMainFrameNavigated)
    hasFrameListener = false
  }

  return {
    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
    start: () => {
      if (!onFrame) throw new Error('onFrame callback must be registered before calling start()')
      stopped = false
      attachFrameListener()
      return startScreencast()
    },
    onFrame: fn => (onFrame = fn),
    stop: () => {
      stopped = true
      detachFrameListener()
      return cdp.send('Page.stopScreencast').catch(() => {})
    }
  }
}

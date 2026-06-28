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

  const onScreencastFrame = async ({ data, metadata, sessionId }) => {
    try {
      if (metadata.timestamp && onFrame) await onFrame(data, metadata)
    } catch {
      // Swallow any onFrame error (sync throw or async rejection): a frame-callback
      // failure must not propagate into puppeteer's CDP dispatch loop, and the
      // screencast stream must not stall on a single bad frame.
    }
    // Ack regardless of outcome, but the frame may settle after stop(): don't ack
    // a torn-down session (a stale ack could race a subsequent screencast on the
    // same page).
    if (!stopped) ack(sessionId)
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

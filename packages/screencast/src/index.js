'use strict'

module.exports = (page, opts) => {
  const cdp = page._client()
  let onFrame
  let hasFrameListener = false

  const ack = sessionId => cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})

  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    if (!metadata.timestamp || !onFrame) return ack(sessionId)

    let result
    try {
      result = onFrame(data, metadata)
    } catch (error) {
      ack(sessionId)
      throw error
    }

    if (!result || typeof result.then !== 'function') return ack(sessionId)

    return Promise.resolve(result)
      .catch(() => {})
      .then(() => ack(sessionId))
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
      attachFrameListener()
      return cdp.send('Page.startScreencast', opts)
    },
    onFrame: fn => (onFrame = fn),
    stop: () => {
      detachFrameListener()
      return cdp.send('Page.stopScreencast').catch(() => {})
    }
  }
}

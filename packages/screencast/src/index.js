'use strict'

module.exports = (page, opts) => {
  const cdp = page._client()
  let onFrame
  let hasFrameListener = false

  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (metadata.timestamp && onFrame) onFrame(data, metadata)
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

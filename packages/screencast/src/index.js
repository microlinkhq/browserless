'use strict'

module.exports = (page, opts) => {
  const cdp = page._client()
  let onFrame
  let isStopped = false

  const onScreencastFrame = ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (metadata.timestamp && typeof onFrame === 'function') onFrame(data, metadata)
  }

  cdp.on('Page.screencastFrame', onScreencastFrame)

  return {
    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
    start: () => cdp.send('Page.startScreencast', opts),
    onFrame: fn => (onFrame = fn),
    stop: () => {
      if (isStopped) return Promise.resolve()
      isStopped = true
      if (typeof cdp.off === 'function') {
        cdp.off('Page.screencastFrame', onScreencastFrame)
      } else if (typeof cdp.removeListener === 'function') {
        cdp.removeListener('Page.screencastFrame', onScreencastFrame)
      }
      return cdp.send('Page.stopScreencast').catch(() => {})
    }
  }
}

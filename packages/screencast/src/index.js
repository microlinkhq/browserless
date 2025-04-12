'use strict'

module.exports = (page, opts) => {
  const cdp = page._client()
  let onFrame

  cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (metadata.timestamp) onFrame(data, metadata)
  })

  return {
    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
    start: () => cdp.send('Page.startScreencast', opts),
    onFrame: fn => (onFrame = fn),
    stop: () => cdp.send('Page.stopScreencast').catch(() => {})
  }
}

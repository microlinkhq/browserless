'use strict'

const getCDPClient = page => page._client()

module.exports = (page, opts) => {
  const client = getCDPClient(page)
  let onFrame

  client.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
    if (metadata.timestamp) onFrame(data, metadata)
  })

  return {
    // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
    start: () => client.send('Page.startScreencast', opts),
    onFrame: fn => (onFrame = fn),
    stop: async () => client.send('Page.stopScreencast')
  }
}

'use strict'

const getCDPClient = page => page._client()

const startScreencast = async (page, { onFrame, ...opts }) => {
  const client = getCDPClient(page)
  const frames = []

  client.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    if (metadata.timestamp) frames.push({ data: Buffer.from(data, 'base64'), metadata })
    client.send('Page.screencastFrameAck', { sessionId }).catch(() => {})
  })

  // https://chromedevtools.github.io/devtools-protocol/tot/Page/#method-startScreencast
  await client.send('Page.startScreencast', opts)

  return async () => {
    await client.send('Page.stopScreencast')
    return frames.sort((a, b) => a.metadata.timestamp - b.metadata.timestamp)
  }
}

module.exports = { getCDPClient, startScreencast }

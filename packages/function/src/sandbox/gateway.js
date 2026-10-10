'use strict'

const { WebSocketServer, WebSocket } = require('ws')
const { randomBytes } = require('crypto')

const createScope = require('./scope')

const LOOPBACK = '127.0.0.1'
const TOKEN_BYTES = 32
const MAX_PAYLOAD_BYTES = 256 * 1024 * 1024
const MAX_BACKLOG_BYTES = 64 * 1024 * 1024
const MAX_BUFFERED_BYTES = MAX_PAYLOAD_BYTES + MAX_BACKLOG_BYTES
const INTERNAL_ERROR_CLOSE_CODE = 1011

const grants = new Map()

let listening

const grantOf = req => grants.get(req.url.slice(1))

const verifyClient = ({ req }) => {
  const grant = grantOf(req)
  return grant !== undefined && !grant.socket && req.headers.origin === undefined
}

const openScope = async (grant, socket) =>
  createScope({
    root: await grant.browser.target().createCDPSession(),
    browserContextId: grant.browserContextId,
    allowFileAccess: grant.allowFileAccess,
    onDenied: grant.onDenied,
    send: message => {
      if (socket.readyState !== WebSocket.OPEN) return
      if (socket.bufferedAmount > MAX_BUFFERED_BYTES) return socket.terminate()
      socket.send(JSON.stringify(message))
    },
    close: () => socket.close()
  })

const onConnection = (socket, req) => {
  const grant = grantOf(req)
  if (!grant) return socket.close()
  grant.socket = socket

  const opening = openScope(grant, socket)
  opening.catch(() => socket.close(INTERNAL_ERROR_CLOSE_CODE))
  socket.on('error', () => socket.close())
  socket.on('message', data => opening.then(scope => scope.handle(data.toString())).catch(() => {}))
  socket.on('close', () => {
    grant.socket = undefined
    const previous = grant.disposed ?? Promise.resolve()
    grant.disposed = previous.then(() => opening.then(scope => scope.dispose())).catch(() => {})
  })
}

const listen = () => {
  listening ??= new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      host: LOOPBACK,
      port: 0,
      maxPayload: MAX_PAYLOAD_BYTES,
      perMessageDeflate: false,
      verifyClient
    })
    server.on('connection', onConnection)
    server.once('error', reject)
    server.once('listening', () => {
      server._server.unref()
      resolve(server)
    })
  })
  return listening
}

const terminate = socket =>
  new Promise(resolve => {
    socket.once('close', resolve)
    socket.terminate()
  })

const grant = async (page, { onDenied = () => {}, allowFileAccess = false } = {}) => {
  const browserContextId = page.browserContext().id
  if (!browserContextId) throw new Error('A function page needs its own browser context')
  const server = await listen()
  const token = randomBytes(TOKEN_BYTES).toString('hex')
  const entry = {
    browser: page.browser(),
    browserContextId,
    allowFileAccess,
    onDenied,
    socket: undefined
  }
  grants.set(token, entry)

  return {
    endpoint: `ws://${LOOPBACK}:${server.address().port}/${token}`,
    revoke: async () => {
      grants.delete(token)
      if (entry.socket) await terminate(entry.socket)
      await entry.disposed
    }
  }
}

const close = async () => {
  if (!listening) return
  const server = await listening
  listening = undefined
  for (const client of server.clients) client.terminate()
  grants.clear()
  await new Promise(resolve => server.close(resolve))
}

module.exports = { grant, listen, close }

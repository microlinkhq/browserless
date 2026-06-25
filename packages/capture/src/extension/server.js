'use strict'

const { WebSocketServer } = require('ws')

const closeServer = wss => {
  const { promise, resolve } = Promise.withResolvers()

  if (!wss) {
    resolve()
    return promise
  }

  try {
    wss.close(() => resolve())
  } catch (error) {
    resolve()
  }

  return promise
}

const createWebSocketServer = () => {
  const { promise, resolve, reject } = Promise.withResolvers()
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 })

  const onListening = () => {
    cleanup()
    const { port } = wss.address()
    resolve({ wss, port })
  }

  const onError = error => {
    cleanup()
    reject(error)
  }

  const cleanup = () => {
    wss.removeListener('listening', onListening).removeListener('error', onError)
  }

  wss.once('listening', onListening).once('error', onError)

  return promise
}

module.exports = {
  closeServer,
  createWebSocketServer
}

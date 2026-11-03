'use strict'

const { anonymizeProxy, closeAnonymizedProxy } = require('proxy-chain')

const REDACTED = '***'

const hasCredentials = proxyServer => {
  const url = URL.parse(proxyServer ?? '')
  return Boolean(url?.username || url?.password)
}

const withoutCredentials = (error, proxyServer) => {
  const { username, password } = URL.parse(proxyServer)
  for (const secret of [username, password].filter(Boolean)) {
    error.message = error.message.replaceAll(secret, REDACTED)
  }
  return error
}

const forwardProxy = async contextOpts => {
  const { proxyServer } = contextOpts
  if (!hasCredentials(proxyServer)) return contextOpts
  try {
    return { ...contextOpts, proxyServer: await anonymizeProxy(proxyServer) }
  } catch (error) {
    throw withoutCredentials(error, proxyServer)
  }
}

const closeForwarder = async contextOptsPromise => {
  const { proxyServer } = await contextOptsPromise.catch(() => ({}))
  if (proxyServer) await closeAnonymizedProxy(proxyServer, true)
}

module.exports = { forwardProxy, closeForwarder }
